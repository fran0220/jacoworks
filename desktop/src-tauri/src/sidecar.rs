use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

type SharedStdin = Arc<Mutex<ChildStdin>>;

struct AgentProcess {
    child: Child,
    stdin: SharedStdin,
}

static AGENT_PROCESS: std::sync::LazyLock<Mutex<Option<AgentProcess>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

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

        let mut cmd = Command::new("node");
        cmd.arg("--enable-source-maps")
            .arg(&entry)
            .current_dir(&resolved_agent_dir)
            .env("MEMORY_ENABLED", "true")
            .env("HEARTBEAT_ENABLED", "false")
            .env("CRON_ENABLED", "false")
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
