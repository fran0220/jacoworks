use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

// ───── Memory helpers ─────────────────────────────────────────

fn memory_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("memory"))
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MemoryStats {
    pub path: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[tauri::command]
pub fn get_memory_stats(app: AppHandle) -> Result<MemoryStats, String> {
    let root = memory_root_dir(&app)?;
    let path = root.display().to_string();

    let mut file_count = 0usize;
    let mut total_bytes = 0u64;

    if root.exists() {
        for entry in walkdir::WalkDir::new(&root)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                file_count += 1;
                total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }

    Ok(MemoryStats {
        path,
        file_count,
        total_bytes,
    })
}

#[tauri::command]
pub fn clear_memory(app: AppHandle) -> Result<(), String> {
    let root = memory_root_dir(&app)?;
    if root.exists() {
        std::fs::remove_dir_all(&root)
            .map_err(|e| format!("Failed to clear memory: {}", e))?;
    }
    Ok(())
}

type SharedStdin = Arc<Mutex<ChildStdin>>;

struct AgentProcess {
    child: Child,
    stdin: SharedStdin,
    workspace: PathBuf,
}

static AGENT_PROCESS: std::sync::LazyLock<Mutex<Option<AgentProcess>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

/// Returns the running agent's workspace directory (used by file-card path resolution).
pub fn agent_workspace() -> Option<PathBuf> {
    AGENT_PROCESS
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.workspace.clone()))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentStatus {
    pub running: bool,
    pub transport: String,
}

fn emit_json_or_log(app: &AppHandle, line: &str, source: &str) -> bool {
    if let Ok(payload) = serde_json::from_str::<serde_json::Value>(line) {
        let is_ready = payload
            .get("type")
            .and_then(|value| value.as_str())
            .map(|value| value == "ready")
            .unwrap_or(false);
        let _ = app.emit("agent-rpc-event", payload);
        return is_ready;
    } else {
        let _ = app.emit(
            "agent-rpc-log",
            serde_json::json!({
                "source": source,
                "line": line,
            }),
        );
        return false;
    }
}

fn signal_ready(sender: &Sender<()>) {
    let _ = sender.send(());
}

fn is_running(process: &mut AgentProcess) -> bool {
    matches!(process.child.try_wait(), Ok(None))
}

fn push_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn resolve_agent_paths(agent_dir: &str) -> Result<(PathBuf, PathBuf), String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let requested = PathBuf::from(agent_dir);
    push_candidate(&mut candidates, requested.clone());

    if requested.is_relative() {
        if let Ok(cwd) = std::env::current_dir() {
            push_candidate(&mut candidates, cwd.join(&requested));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        push_candidate(&mut candidates, cwd.join("vm-agent"));
        push_candidate(&mut candidates, cwd.join("../vm-agent"));
        push_candidate(&mut candidates, cwd.join("../../vm-agent"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    push_candidate(&mut candidates, manifest_dir.join("../vm-agent"));
    push_candidate(&mut candidates, manifest_dir.join("../../vm-agent"));

    if let Some(desktop_dir) = manifest_dir.parent() {
        push_candidate(&mut candidates, desktop_dir.join("../vm-agent"));
    }
    if let Some(repo_dir) = manifest_dir.parent().and_then(Path::parent) {
        push_candidate(&mut candidates, repo_dir.join("vm-agent"));
    }

    let mut tried_entries: Vec<String> = Vec::new();
    for candidate in candidates {
        let resolved_dir = std::fs::canonicalize(&candidate).unwrap_or(candidate);
        let entry = resolved_dir.join("dist").join("index.js");
        tried_entries.push(entry.display().to_string());
        if entry.exists() {
            return Ok((resolved_dir, entry));
        }
    }

    Err(format!(
        "Agent entry not found. requested='{}'; tried: {}",
        agent_dir,
        tried_entries.join(", ")
    ))
}

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    agent_dir: String,
    env_vars: HashMap<String, String>,
) -> Result<AgentStatus, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<()>();

    {
        let mut proc = AGENT_PROCESS.lock().unwrap();

        if let Some(existing) = proc.as_mut() {
            if is_running(existing) {
                return Ok(AgentStatus {
                    running: true,
                    transport: "rpc-stdio".to_string(),
                });
            }
            *proc = None;
        }

        let (resolved_agent_dir, entry) = resolve_agent_paths(&agent_dir)?;

        // User skills directory: <app_data>/skills
        let user_skills_dir = app
            .path()
            .app_data_dir()
            .map(|dir| dir.join("skills"))
            .unwrap_or_default();

        let mut cmd = Command::new("node");
        cmd.arg("--enable-source-maps")
            .arg(&entry)
            .current_dir(&resolved_agent_dir)
            .env("MEMORY_ENABLED", "true")
            .env("HEARTBEAT_ENABLED", "false")
            .env("CRON_ENABLED", "false")
            .env("USER_SKILLS_DIR", user_skills_dir.to_string_lossy().as_ref())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in &env_vars {
            cmd.env(key, value);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn agent: {}", e))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture agent stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture agent stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture agent stderr".to_string())?;

        let app_stdout = app.clone();
        let ready_tx_stdout = ready_tx.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Never block ready handshake on UI log delivery.
                if trimmed.contains("\"type\":\"ready\"") || trimmed.contains("\"type\": \"ready\"") {
                    signal_ready(&ready_tx_stdout);
                }
                if emit_json_or_log(&app_stdout, trimmed, "stdout") {
                    signal_ready(&ready_tx_stdout);
                }
            }
        });

        let app_stderr = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let _ = emit_json_or_log(&app_stderr, trimmed, "stderr");
            }
        });

        *proc = Some(AgentProcess {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            workspace: resolved_agent_dir.clone(),
        });
    }

    // Strict handshake: startup only succeeds after receiving the RPC ready event.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if ready_rx.recv_timeout(Duration::from_millis(100)).is_ok() {
            return Ok(AgentStatus {
                running: true,
                transport: "rpc-stdio".to_string(),
            });
        }

        let mut proc = AGENT_PROCESS.lock().unwrap();
        let Some(existing) = proc.as_mut() else {
            return Err("Agent process disappeared during startup".to_string());
        };

        if !is_running(existing) {
            *proc = None;
            return Err("Agent exited during startup".to_string());
        }

        if Instant::now() >= deadline {
            *proc = None;
            return Err("Agent ready handshake timed out".to_string());
        }
    }
}

#[tauri::command]
pub fn agent_rpc_send(command: serde_json::Value) -> Result<(), String> {
    let mut proc = AGENT_PROCESS.lock().unwrap();
    let Some(process) = proc.as_mut() else {
        return Err("Agent is not running".to_string());
    };

    if !is_running(process) {
        *proc = None;
        return Err("Agent is not running".to_string());
    }

    let mut stdin = process.stdin.lock().unwrap();
    let line = serde_json::to_string(&command).map_err(|e| format!("Invalid command JSON: {}", e))?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("Failed to send command to agent: {}", e))
}

#[tauri::command]
pub fn stop_agent() -> Result<(), String> {
    let mut proc = AGENT_PROCESS.lock().unwrap();
    if let Some(process) = proc.as_mut() {
        process
            .child
            .kill()
            .map_err(|e| format!("Failed to kill agent: {}", e))?;
        process.child.wait().ok();
    }
    *proc = None;
    Ok(())
}

// ───── User skills management ─────────────────────────────────

fn user_skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("skills"))
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))
}

#[tauri::command]
pub fn get_user_skills_dir(app: AppHandle) -> Result<String, String> {
    let dir = user_skills_dir(&app)?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create skills directory: {}", e))?;
    }
    Ok(dir.display().to_string())
}

#[tauri::command]
pub fn delete_user_skill(app: AppHandle, skill_id: String) -> Result<(), String> {
    if skill_id.is_empty() || skill_id.contains("..") || skill_id.contains('/') {
        return Err("Invalid skill id".to_string());
    }
    let dir = user_skills_dir(&app)?;
    let skill_dir = dir.join(&skill_id);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", skill_id));
    }
    // Ensure it's actually inside the user skills dir
    let canonical_skill = skill_dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve skill path: {}", e))?;
    let canonical_root = dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve skills root: {}", e))?;
    if !canonical_skill.starts_with(&canonical_root) {
        return Err("Skill path is outside user skills directory".to_string());
    }
    std::fs::remove_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to delete skill: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn reveal_user_skill(app: AppHandle, skill_id: String) -> Result<(), String> {
    let dir = user_skills_dir(&app)?;
    let skill_dir = dir.join(&skill_id);
    if !skill_dir.exists() {
        // Open the root skills dir if specific skill not found
        if dir.exists() {
            return tauri_plugin_opener::reveal_item_in_dir(&dir).map_err(|e| e.to_string());
        }
        return Err(format!("Skill '{}' not found", skill_id));
    }
    tauri_plugin_opener::reveal_item_in_dir(&skill_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_status() -> AgentStatus {
    let mut proc = AGENT_PROCESS.lock().unwrap();
    if let Some(existing) = proc.as_mut() {
        if is_running(existing) {
            return AgentStatus {
                running: true,
                transport: "rpc-stdio".to_string(),
            };
        }
        *proc = None;
    }

    AgentStatus {
        running: false,
        transport: "rpc-stdio".to_string(),
    }
}
