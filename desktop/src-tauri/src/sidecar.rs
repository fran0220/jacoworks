use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
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

// ───── Memory sync helpers ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryFileEntry {
    pub path: String,
    pub content: String,
}

impl MemoryFileEntry {
    /// Create with forward-slash normalized path for cross-platform consistency.
    fn new(path: String, content: String) -> Self {
        Self {
            path: path.replace('\\', "/"),
            content,
        }
    }
}

/// List all memory files with their content (MEMORY.md + daily/*.md).
#[tauri::command]
pub fn list_memory_files(app: AppHandle) -> Result<Vec<MemoryFileEntry>, String> {
    let root = memory_root_dir(&app)?;
    let mut entries = Vec::new();

    if !root.exists() {
        return Ok(entries);
    }

    // MEMORY.md
    let main_file = root.join("MEMORY.md");
    if main_file.is_file() {
        if let Ok(content) = std::fs::read_to_string(&main_file) {
            if !content.trim().is_empty() {
                entries.push(MemoryFileEntry {
                    path: "MEMORY.md".to_string(),
                    content,
                });
            }
        }
    }

    // daily/*.md
    let daily_dir = root.join("daily");
    if daily_dir.is_dir() {
        if let Ok(dir_entries) = std::fs::read_dir(&daily_dir) {
            for entry in dir_entries.filter_map(|e| e.ok()) {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.ends_with(".md") {
                    continue;
                }
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if !content.trim().is_empty() {
                        entries.push(MemoryFileEntry {
                            path: format!("daily/{}", name),
                            content,
                        });
                    }
                }
            }
        }
    }

    Ok(entries)
}

/// Write memory files received from server sync.
#[tauri::command]
pub fn write_memory_files(app: AppHandle, files: Vec<MemoryFileEntry>) -> Result<usize, String> {
    let root = memory_root_dir(&app)?;
    let mut written = 0usize;

    for file in &files {
        let local_path = if file.path == "MEMORY.md" {
            root.join("MEMORY.md")
        } else if let Some(name) = file.path.strip_prefix("daily/") {
            let daily_dir = root.join("daily");
            if !daily_dir.exists() {
                std::fs::create_dir_all(&daily_dir)
                    .map_err(|e| format!("Failed to create daily dir: {}", e))?;
            }
            daily_dir.join(name)
        } else {
            continue;
        };

        if let Some(parent) = local_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir: {}", e))?;
            }
        }

        std::fs::write(&local_path, &file.content)
            .map_err(|e| format!("Failed to write {}: {}", file.path, e))?;
        written += 1;
    }

    Ok(written)
}

/// Return the memory root directory path.
#[tauri::command]
pub fn get_memory_root(app: AppHandle) -> Result<String, String> {
    memory_root_dir(&app).map(|p| p.display().to_string())
}

// ───── Skills sync helpers ────────────────────────────────────

/// Recursively read all files in a skills directory.
#[tauri::command]
pub fn list_skill_files(dir: String) -> Result<Vec<MemoryFileEntry>, String> {
    let root = PathBuf::from(&dir);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    collect_files_recursive(&root, &root, &mut entries)?;
    Ok(entries)
}

fn collect_files_recursive(
    base: &Path,
    current: &Path,
    entries: &mut Vec<MemoryFileEntry>,
) -> Result<(), String> {
    let dir_entries =
        std::fs::read_dir(current).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in dir_entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursive(base, &path, entries)?;
        } else if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let rel = path
                    .strip_prefix(base)
                    .map_err(|e| format!("Path strip error: {}", e))?
                    .to_string_lossy()
                    .to_string();
                entries.push(MemoryFileEntry::new(rel, content));
            }
        }
    }
    Ok(())
}

type SharedStdin = Arc<Mutex<ChildStdin>>;

type SharedStderrBuf = Arc<Mutex<Vec<String>>>;

struct AgentProcess {
    child: Child,
    stdin: SharedStdin,
    workspace: PathBuf,
    stderr_buf: SharedStderrBuf,
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

// ───── Sidecar binary resolution ──────────────────────────────

/// Look for the bun-compiled sidecar binary next to the main executable.
/// Returns None in dev mode (binary not bundled).
fn find_sidecar_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    // Tauri may bundle as "vm-agent" (stripped triple) or "vm-agent-{triple}"
    let triple = option_env!("TARGET_TRIPLE")
        .map(str::to_string)
        .or_else(|| std::env::var("TARGET_TRIPLE").ok())
        .filter(|v| !v.is_empty());

    let mut candidates = Vec::new();
    if cfg!(windows) {
        if let Some(triple) = &triple {
            candidates.push(format!("vm-agent-{}.exe", triple));
        }
        candidates.push("vm-agent.exe".to_string());
    } else {
        if let Some(triple) = &triple {
            candidates.push(format!("vm-agent-{}", triple));
        }
        candidates.push("vm-agent".to_string());
    }

    for name in candidates {
        let path = dir.join(&name);
        if path.exists() {
            // Skip tiny dev placeholders; real bun-compiled binaries are much larger.
            if let Ok(meta) = path.metadata() {
                if meta.len() < 1024 {
                    continue;
                }
            }
            return Some(path);
        }
    }
    None
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
        let resolved_dir = dunce::canonicalize(&candidate).unwrap_or(candidate);
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

        // User skills directory: <app_data>/skills
        let user_skills_dir = app
            .path()
            .app_data_dir()
            .map(|dir| dir.join("skills"))
            .unwrap_or_default();
        let memory_root = app
            .path()
            .app_data_dir()
            .map(|dir| dir.join("memory"))
            .unwrap_or_default();

        // Dual mode: production (compiled binary) vs dev (node + dist/index.js)
        let (mut cmd, resolved_agent_dir) = if let Some(binary) = find_sidecar_binary() {
            // Production: bun-compiled sidecar binary
            let bin_dir = binary.parent().unwrap_or(Path::new(".")).to_path_buf();
            let mut c = Command::new(&binary);
            c.current_dir(&bin_dir);

            // PI_PACKAGE_DIR: resource dir contains pi-meta/package.json
            if let Ok(resource_dir) = app.path().resource_dir() {
                let pi_meta = resource_dir.join("resources").join("pi-meta");
                if pi_meta.exists() {
                    c.env("PI_PACKAGE_DIR", pi_meta.to_string_lossy().as_ref());
                }
            }
            (c, bin_dir)
        } else {
            // Dev fallback: node + dist/index.js
            let (resolved_dir, entry) = resolve_agent_paths(&agent_dir)?;
            let mut c = Command::new("node");
            c.arg("--enable-source-maps")
                .arg(&entry)
                .current_dir(&resolved_dir);
            (c, resolved_dir)
        };

        // Built-in skills: explicitly pass SKILLS_PATHS so the compiled binary
        // doesn't have to guess via import.meta.url (which breaks in bundled mode).
        {
            let mut skills_paths: Vec<String> = Vec::new();

            // 1. Production: bundled in resources/skills/
            if let Ok(resource_dir) = app.path().resource_dir() {
                let bundled = resource_dir.join("resources").join("skills");
                if bundled.exists() {
                    skills_paths.push(bundled.to_string_lossy().to_string());
                }
            }

            // 2. Dev fallback: monorepo vm-agent/skills/
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            let dev_skills = manifest_dir.join("../../vm-agent/skills");
            if let Ok(canonical) = dunce::canonicalize(&dev_skills) {
                if canonical.exists() && !skills_paths.iter().any(|p| PathBuf::from(p) == canonical) {
                    skills_paths.push(canonical.to_string_lossy().to_string());
                }
            }

            if !skills_paths.is_empty() {
                cmd.env("SKILLS_PATHS", skills_paths.join(","));
            }
        }

        // Document processing packages (NODE_PATH for .mjs scripts)
        if let Ok(app_data) = app.path().app_data_dir() {
            let doc_pkg_dir = app_data.join("doc-packages");

            // Extract bundled archive on first launch
            if !doc_pkg_dir.join("node_modules").exists() {
                if let Ok(resource_dir) = app.path().resource_dir() {
                    let archive = resource_dir.join("resources").join("doc-packages.tar.gz");
                    if archive.exists() {
                        let _ = std::fs::create_dir_all(&doc_pkg_dir);
                        if let Ok(file) = std::fs::File::open(&archive) {
                            let gz = flate2::read::GzDecoder::new(file);
                            let mut tar = tar::Archive::new(gz);
                            if tar.unpack(&doc_pkg_dir).is_ok() {
                                eprintln!("[sidecar] Extracted doc-packages to {}", doc_pkg_dir.display());
                            }
                        }
                    }
                }
            }

            cmd.env("DOC_PACKAGES_DIR", doc_pkg_dir.to_string_lossy().as_ref());
        }

        // Bundled fonts directory
        if let Ok(resource_dir) = app.path().resource_dir() {
            let fonts_dir = resource_dir.join("resources").join("fonts");
            if fonts_dir.exists() {
                cmd.env("FONTS_DIR", fonts_dir.to_string_lossy().as_ref());
            }
        }

        // Prepend bundled runtimes to PATH — guaranteed available by build process.
        // Python: all platforms (python-build-standalone).
        // Bash + Node: Windows only (MSYS2 bash + Bun).
        if let Ok(resource_dir) = app.path().resource_dir() {
            let runtimes = resource_dir.join("resources").join("runtimes");
            let mut extra_paths: Vec<PathBuf> = Vec::new();

            // Python (all platforms): python-build-standalone uses bin/ on unix, flat on windows
            #[cfg(not(windows))]
            extra_paths.push(runtimes.join("python").join("bin"));
            #[cfg(windows)]
            extra_paths.push(runtimes.join("python"));

            // Windows-only: bash (MSYS2) + node (Bun)
            #[cfg(windows)]
            {
                extra_paths.push(runtimes.join("bash"));
                extra_paths.push(runtimes.join("node"));

                // MSYS2 environment for bash
                cmd.env("CHERE_INVOKING", "1");
                cmd.env("MSYS2_PATH_TYPE", "inherit");
                cmd.env("MSYS2_ARG_CONV_EXCL", "*");
                cmd.env("LANG", "C.UTF-8");
                cmd.env("LC_ALL", "C.UTF-8");
            }

            let current_path = std::env::var("PATH").unwrap_or_default();
            let existing: Vec<PathBuf> = std::env::split_paths(&current_path).collect();
            let mut all_paths = extra_paths;
            all_paths.extend(existing);

            if let Ok(new_path) = std::env::join_paths(&all_paths) {
                cmd.env("PATH", &new_path);
            }
        }

        if !memory_root.as_os_str().is_empty() {
            std::fs::create_dir_all(&memory_root).ok();
            cmd.env("MEMORY_ROOT_DIR", memory_root.to_string_lossy().as_ref());
        }

        cmd.env("MEMORY_ENABLED", "true")
            .env("HEARTBEAT_ENABLED", "false")
            .env("CRON_ENABLED", "false")
            .env("USER_SKILLS_DIR", user_skills_dir.to_string_lossy().as_ref())
            .env(
                "AGENT_HOME_DIR",
                app.path()
                    .app_data_dir()
                    .map(|dir| dir.to_string_lossy().to_string())
                    .unwrap_or_default(),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Make sidecar the leader of a new process group so killpg can reap descendants.
            cmd.process_group(0);
        }

        // Windows: hide the console window for the sidecar process
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // Apply caller-provided env vars, but protect enforced keys.
        const PROTECTED_KEYS: &[&str] = &[
            "MEMORY_ROOT_DIR", "USER_SKILLS_DIR", "AGENT_HOME_DIR",
            "MEMORY_ENABLED", "HEARTBEAT_ENABLED", "CRON_ENABLED",
        ];
        for (key, value) in &env_vars {
            if !PROTECTED_KEYS.contains(&key.as_str()) {
                cmd.env(key, value);
            }
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
            // Agent stdout closed (process exited or crashed) — notify all listening streams
            let _ = app_stdout.emit("agent-rpc-event", serde_json::json!({
                "type": "error",
                "error": "Agent 进程已退出"
            }));
        });

        let app_stderr = app.clone();
        let stderr_buf: SharedStderrBuf = Arc::new(Mutex::new(Vec::new()));
        let stderr_buf_writer = stderr_buf.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Keep last 10 stderr lines for diagnostics on crash
                if let Ok(mut buf) = stderr_buf_writer.lock() {
                    if buf.len() >= 10 {
                        buf.remove(0);
                    }
                    buf.push(trimmed.to_string());
                }
                let _ = emit_json_or_log(&app_stderr, trimmed, "stderr");
            }
        });

        *proc = Some(AgentProcess {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            workspace: resolved_agent_dir.clone(),
            stderr_buf,
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
            let exit_info = match existing.child.try_wait() {
                Ok(Some(status)) => format!(" (exit {})", status),
                _ => String::new(),
            };
            let stderr_tail = existing
                .stderr_buf
                .lock()
                .ok()
                .map(|buf| buf.join(" | "))
                .unwrap_or_default();
            *proc = None;
            let detail = if stderr_tail.is_empty() {
                format!("Agent exited during startup{}", exit_info)
            } else {
                format!("Agent exited during startup{}: {}", exit_info, stderr_tail)
            };
            return Err(detail);
        }

        if Instant::now() >= deadline {
            if let Some(existing) = proc.as_mut() {
                kill_process_tree(&mut existing.child);
            }
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
        kill_process_tree(&mut process.child);
    }
    *proc = None;
    Ok(())
}

fn kill_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        if pid > 0 {
            // Try process-group termination first to clean up descendants.
            unsafe {
                libc::killpg(pid, libc::SIGTERM);
            }
            std::thread::sleep(Duration::from_millis(200));
            unsafe {
                libc::killpg(pid, libc::SIGKILL);
            }
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let pid = child.id();
        if pid > 0 {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
    }

    let _ = child.kill();
    let _ = child.wait();
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
    if skill_id.is_empty() || skill_id.contains("..") || skill_id.contains('/') || skill_id.contains('\\') {
        return Err("Invalid skill id".to_string());
    }
    let dir = user_skills_dir(&app)?;
    let skill_dir = dir.join(&skill_id);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", skill_id));
    }
    // Ensure it's actually inside the user skills dir
    let canonical_skill =
        dunce::canonicalize(&skill_dir).map_err(|e| format!("Cannot resolve skill path: {}", e))?;
    let canonical_root =
        dunce::canonicalize(&dir).map_err(|e| format!("Cannot resolve skills root: {}", e))?;
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
