use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
        std::fs::remove_dir_all(&root).map_err(|e| format!("Failed to clear memory: {}", e))?;
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

const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
const LOG_KEEP_FILES: usize = 3;
const PI_SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const PI_SESSION_CLEANUP_INTERVAL: Duration = Duration::from_secs(5 * 60);
const READY_TIMEOUT: Duration = Duration::from_secs(10);
static AGENT_LOG_LOCK: std::sync::LazyLock<Mutex<()>> =
    std::sync::LazyLock::new(|| Mutex::new(()));
static PI_SESSION_CLEANUP_STARTED: std::sync::OnceLock<()> = std::sync::OnceLock::new();

struct AgentProcess {
    child: Child,
    stdin: SharedStdin,
    session_id: String,
    workspace: PathBuf,
    stderr_buf: SharedStderrBuf,
    last_access: Instant,
}

static AGENT_PROCESSES: std::sync::LazyLock<Mutex<HashMap<String, AgentProcess>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Returns the running agent's workspace directory (used by file-card path resolution).
pub fn agent_workspace() -> Option<PathBuf> {
    let mut processes = AGENT_PROCESSES.lock().ok()?;
    prune_exited_processes(&mut processes);

    let mut selected: Option<(Duration, PathBuf)> = None;
    for process in processes.values() {
        let idle = process.last_access.elapsed();
        let should_replace = selected
            .as_ref()
            .map(|(best_idle, _)| idle < *best_idle)
            .unwrap_or(true);
        if should_replace {
            selected = Some((idle, process.workspace.clone()));
        }
    }

    selected.map(|(_, workspace)| workspace)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentStatus {
    pub running: bool,
    pub transport: String,
}

fn agent_log_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("logs"))
}

fn rotate_log(log_path: &Path) {
    for i in (1..LOG_KEEP_FILES).rev() {
        let from = if i == 1 {
            log_path.to_path_buf()
        } else {
            log_path.with_extension(format!("log.{}", i - 1))
        };
        let to = log_path.with_extension(format!("log.{}", i));
        if from.exists() {
            let _ = fs::rename(&from, &to);
        }
    }
}

fn append_log_line(app: &AppHandle, source: &str, line: &str) {
    let _guard = match AGENT_LOG_LOCK.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let Some(log_dir) = agent_log_dir(app) else { return };
    let _ = fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("agent.log");

    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() >= LOG_MAX_BYTES {
            rotate_log(&log_path);
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let entry = format!("[{}] [{}] {}\n", ts, source, line);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = file.write_all(entry.as_bytes());
    }
}

fn handle_session_line(
    app: &AppHandle,
    line: &str,
    source: &str,
    session_id: Option<&str>,
) -> bool {
    append_log_line(app, source, line);
    emit_json_or_log(app, line, source, session_id)
}

fn emit_json_or_log(
    app: &AppHandle,
    line: &str,
    source: &str,
    session_id: Option<&str>,
) -> bool {
    if let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(line) {
        if let (Some(session_id), Some(object)) = (session_id, payload.as_object_mut()) {
            object
                .entry("session_id".to_string())
                .or_insert_with(|| serde_json::Value::String(session_id.to_string()));
        }

        let is_ready = payload
            .get("type")
            .and_then(|value| value.as_str())
            .map(|value| value == "session")
            .unwrap_or(false);
        let _ = app.emit("agent-rpc-event", payload);
        return is_ready;
    } else {
        let _ = app.emit(
            "agent-rpc-log",
            serde_json::json!({
                "source": source,
                "line": line,
                "session_id": session_id,
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

fn mark_process_access(process: &mut AgentProcess) {
    process.last_access = Instant::now();
}

fn prune_exited_processes(processes: &mut HashMap<String, AgentProcess>) {
    processes.retain(|_, process| is_running(process));
}

fn normalize_proxy_url(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

fn pi_agent_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    Ok(home.join(".pi").join("agent"))
}

fn resolve_pi_config_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("pi-config"));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("../../pi-config"));

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn resolve_skill_paths(app: &AppHandle) -> Vec<String> {
    let mut skills_paths: Vec<String> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("resources").join("skills");
        if bundled.exists() {
            skills_paths.push(bundled.to_string_lossy().to_string());
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_skills = manifest_dir.join("../../vm-agent/skills");
    if let Ok(canonical) = dunce::canonicalize(&dev_skills) {
        let canonical_str = canonical.to_string_lossy().to_string();
        if canonical.exists() && !skills_paths.iter().any(|p| p == &canonical_str) {
            skills_paths.push(canonical_str);
        }
    }

    skills_paths
}

fn infer_provider_for_model(model: &str) -> String {
    if model.starts_with("claude-") {
        return "proxy-claude".to_string();
    }
    if model.starts_with("gpt-") {
        return "proxy-gpt".to_string();
    }
    if model.starts_with("gemini-") {
        return "proxy-gemini".to_string();
    }
    if model.starts_with("grok-") {
        return "proxy-grok".to_string();
    }
    if model.starts_with("glm-") {
        return "proxy-glm".to_string();
    }

    "proxy-claude".to_string()
}

fn resolve_primary_selection(env_vars: &HashMap<String, String>) -> (String, String) {
    let raw_model = env_vars
        .get("PRIMARY_MODEL")
        .cloned()
        .unwrap_or_else(|| "claude-opus-4-6".to_string());
    let raw_provider = env_vars
        .get("PRIMARY_PROVIDER")
        .cloned()
        .unwrap_or_default();

    if let Some((provider, model)) = raw_model.split_once('/') {
        let provider = if raw_provider.is_empty() {
            provider.to_string()
        } else {
            raw_provider
        };
        return (provider, model.to_string());
    }

    let provider = if raw_provider.is_empty() {
        infer_provider_for_model(&raw_model)
    } else {
        raw_provider
    };

    (provider, raw_model)
}

fn build_models_config(proxy_url: &str) -> serde_json::Value {
    let proxy_url = normalize_proxy_url(proxy_url);
    let openai_proxy_url = format!("{}/v1", proxy_url);

    serde_json::json!({
        "providers": {
            "proxy-claude": {
                "baseUrl": proxy_url,
                "apiKey": "LLM_PROXY_KEY",
                "api": "anthropic-messages",
                "models": [
                    {
                        "id": "claude-sonnet-4-6",
                        "name": "Claude Sonnet 4.6",
                        "reasoning": true,
                        "input": ["text", "image"],
                        "contextWindow": 200000,
                        "maxTokens": 16384,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    },
                    {
                        "id": "claude-opus-4-6",
                        "name": "Claude Opus 4.6",
                        "reasoning": true,
                        "input": ["text", "image"],
                        "contextWindow": 200000,
                        "maxTokens": 16384,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    },
                    {
                        "id": "claude-haiku-4-5",
                        "name": "Claude Haiku 4.5",
                        "reasoning": false,
                        "input": ["text", "image"],
                        "contextWindow": 200000,
                        "maxTokens": 8192,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    }
                ]
            },
            "proxy-gpt": {
                "baseUrl": openai_proxy_url,
                "apiKey": "LLM_PROXY_KEY",
                "api": "openai-completions",
                "models": [
                    {
                        "id": "gpt-5.3-codex",
                        "name": "GPT-5.3 Codex",
                        "reasoning": true,
                        "input": ["text"],
                        "contextWindow": 128000,
                        "maxTokens": 16384,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    },
                    {
                        "id": "gpt-5.4",
                        "name": "GPT-5.4",
                        "reasoning": true,
                        "input": ["text", "image"],
                        "contextWindow": 128000,
                        "maxTokens": 16384,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    }
                ]
            },
            "proxy-gemini": {
                "baseUrl": openai_proxy_url,
                "apiKey": "LLM_PROXY_KEY",
                "api": "openai-completions",
                "models": [
                    {
                        "id": "gemini-3.1-pro-preview",
                        "name": "Gemini 3.1 Pro",
                        "reasoning": true,
                        "input": ["text", "image"],
                        "contextWindow": 1000000,
                        "maxTokens": 8192,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    },
                    {
                        "id": "gemini-3-flash-preview",
                        "name": "Gemini 3 Flash",
                        "reasoning": false,
                        "input": ["text", "image"],
                        "contextWindow": 1000000,
                        "maxTokens": 8192,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    }
                ]
            },
            "proxy-grok": {
                "baseUrl": openai_proxy_url,
                "apiKey": "LLM_PROXY_KEY",
                "api": "openai-completions",
                "models": [
                    {
                        "id": "grok-4.1-fast",
                        "name": "Grok 4.1 Fast",
                        "reasoning": false,
                        "input": ["text"],
                        "contextWindow": 128000,
                        "maxTokens": 8192,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    }
                ]
            },
            "proxy-glm": {
                "baseUrl": openai_proxy_url,
                "apiKey": "LLM_PROXY_KEY",
                "api": "openai-completions",
                "models": [
                    {
                        "id": "glm-5",
                        "name": "GLM-5",
                        "reasoning": false,
                        "input": ["text", "image"],
                        "contextWindow": 128000,
                        "maxTokens": 16384,
                        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
                    }
                ]
            }
        }
    })
}

fn build_settings_config(
    env_vars: &HashMap<String, String>,
    skill_paths: Vec<String>,
) -> serde_json::Value {
    let (default_provider, default_model) = resolve_primary_selection(env_vars);
    let reserve_tokens = env_vars
        .get("COMPACTION_RESERVE_TOKENS")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(32768);
    let keep_recent_tokens = env_vars
        .get("COMPACTION_KEEP_RECENT_TOKENS")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(40000);

    serde_json::json!({
        "defaultProvider": default_provider,
        "defaultModel": default_model,
        "quietStartup": true,
        "compaction": {
            "reserveTokens": reserve_tokens,
            "keepRecentTokens": keep_recent_tokens,
        },
        "skills": skill_paths,
    })
}

fn sync_pi_extensions(pi_dir: &Path, app: &AppHandle) {
    let extensions_dir = pi_dir.join("extensions");
    if let Err(error) = fs::create_dir_all(&extensions_dir) {
        append_log_line(
            app,
            "sidecar",
            &format!("Failed to create Pi extensions dir: {}", error),
        );
        return;
    }

    let Some(config_dir) = resolve_pi_config_dir() else {
        append_log_line(app, "sidecar", "pi-config directory not found; skipping custom extension sync");
        return;
    };

    for file_name in ["visual.ts", "cron-proxy.ts", "image-gen.ts"] {
        let source = config_dir.join("extensions").join(file_name);
        if !source.is_file() {
            continue;
        }

        let destination = extensions_dir.join(file_name);
        if let Err(error) = fs::copy(&source, &destination) {
            append_log_line(
                app,
                "sidecar",
                &format!(
                    "Failed to sync Pi extension {}: {}",
                    source.display(),
                    error
                ),
            );
        }
    }
}

fn write_pi_config(app: &AppHandle, env_vars: &HashMap<String, String>) -> Result<PathBuf, String> {
    let proxy_url = env_vars
        .get("LLM_PROXY_URL")
        .cloned()
        .ok_or_else(|| "Missing LLM_PROXY_URL for Pi config generation".to_string())?;
    let pi_dir = pi_agent_dir()?;
    fs::create_dir_all(&pi_dir)
        .map_err(|error| format!("Failed to create Pi agent dir: {}", error))?;

    let user_skills_dir = user_skills_dir(app)?;
    fs::create_dir_all(&user_skills_dir)
        .map_err(|error| format!("Failed to create skills directory: {}", error))?;

    let mut skills = resolve_skill_paths(app);
    let user_skills = user_skills_dir.to_string_lossy().to_string();
    if !skills.iter().any(|path| path == &user_skills) {
        skills.push(user_skills);
    }

    let models_path = pi_dir.join("models.json");
    let settings_path = pi_dir.join("settings.json");
    let models = build_models_config(&proxy_url);
    let settings = build_settings_config(env_vars, skills);

    let models_json = serde_json::to_vec_pretty(&models)
        .map_err(|error| format!("Failed to encode models.json: {}", error))?;
    let settings_json = serde_json::to_vec_pretty(&settings)
        .map_err(|error| format!("Failed to encode settings.json: {}", error))?;

    fs::write(&models_path, models_json)
        .map_err(|error| format!("Failed to write models.json: {}", error))?;
    fs::write(&settings_path, settings_json)
        .map_err(|error| format!("Failed to write settings.json: {}", error))?;
    sync_pi_extensions(&pi_dir, app);

    Ok(pi_dir)
}

fn interrupt_process(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id() as i32;
        if pid > 0 {
            unsafe {
                libc::killpg(pid, libc::SIGINT);
            }
        }
    }

    #[cfg(windows)]
    {
        let _ = child.kill();
    }
}

fn stop_process(process: &mut AgentProcess) {
    kill_process_tree(&mut process.child);
}

fn cleanup_idle_sessions(app: &AppHandle) {
    let mut removed = Vec::new();

    {
        let mut processes = AGENT_PROCESSES.lock().unwrap();
        let idle_ids: Vec<String> = processes
            .iter_mut()
            .filter_map(|(session_id, process)| {
                if !is_running(process) || process.last_access.elapsed() >= PI_SESSION_IDLE_TIMEOUT {
                    Some(session_id.clone())
                } else {
                    None
                }
            })
            .collect();

        for session_id in idle_ids {
            if let Some(process) = processes.remove(&session_id) {
                removed.push(process);
            }
        }
    }

    for mut process in removed {
        let was_idle = process.last_access.elapsed() >= PI_SESSION_IDLE_TIMEOUT;
        let session_id = process.session_id.clone();
        if is_running(&mut process) {
            stop_process(&mut process);
        }
        if was_idle {
            let detail = "Pi session cleaned up after 30 minutes of inactivity";
            append_log_line(app, "sidecar", detail);
            let _ = app.emit(
                "agent-rpc-event",
                serde_json::json!({
                    "type": "error",
                    "session_id": session_id,
                    "error": detail,
                }),
            );
        }
    }
}

fn ensure_cleanup_thread(app: &AppHandle) {
    if PI_SESSION_CLEANUP_STARTED.set(()).is_err() {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(PI_SESSION_CLEANUP_INTERVAL);
        cleanup_idle_sessions(&app);
    });
}

fn spawn_pi_process(
    app: &AppHandle,
    session_id: &str,
    env_vars: &HashMap<String, String>,
) -> Result<AgentProcess, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))?;
    let user_skills_dir = user_skills_dir(app)?;
    let memory_root = memory_root_dir(app)?;
    let workspace = env_vars
        .get("WORKSPACE_DIR")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| app_data_dir.clone());

    if !memory_root.as_os_str().is_empty() {
        std::fs::create_dir_all(&memory_root).ok();
    }
    std::fs::create_dir_all(&user_skills_dir).ok();

    let pi_dir = write_pi_config(app, env_vars)?;
    let mut cmd = Command::new("pi");
    cmd.args(["--mode", "json"])
        .current_dir(&workspace)
        .env("PI_CODING_AGENT_DIR", pi_dir.to_string_lossy().to_string())
        .env("WORKSPACE_DIR", workspace.to_string_lossy().to_string())
        .env("MEMORY_ROOT_DIR", memory_root.to_string_lossy().to_string())
        .env("MEMORY_ENABLED", "true")
        .env("HEARTBEAT_ENABLED", "false")
        .env("CRON_ENABLED", "false")
        .env("USER_SKILLS_DIR", user_skills_dir.to_string_lossy().to_string())
        .env("AGENT_HOME_DIR", app_data_dir.to_string_lossy().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Ok(resource_dir) = app.path().resource_dir() {
        let fonts_dir = resource_dir.join("resources").join("fonts");
        if fonts_dir.exists() {
            cmd.env("FONTS_DIR", fonts_dir.to_string_lossy().to_string());
        }

        let runtimes = resource_dir.join("resources").join("runtimes");
        let mut extra_paths: Vec<PathBuf> = Vec::new();

        #[cfg(not(windows))]
        extra_paths.push(runtimes.join("python").join("bin"));
        #[cfg(windows)]
        extra_paths.push(runtimes.join("python"));

        #[cfg(windows)]
        {
            extra_paths.push(runtimes.join("bash"));
            extra_paths.push(runtimes.join("node"));

            cmd.env("CHERE_INVOKING", "1");
            cmd.env("MSYS2_PATH_TYPE", "inherit");
            cmd.env("MSYS2_ARG_CONV_EXCL", "*");
            cmd.env("LANG", "C.UTF-8");
            cmd.env("LC_ALL", "C.UTF-8");
        }

        #[cfg(not(windows))]
        {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
            if let Ok(output) = Command::new(&shell)
                .args(["-l", "-i", "-c", "echo __PATH_PROBE__\"$PATH\""])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output()
            {
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    if let Some(line) = stdout.lines().find(|l| l.starts_with("__PATH_PROBE__")) {
                        let shell_path = &line["__PATH_PROBE__".len()..];
                        for path in std::env::split_paths(shell_path) {
                            extra_paths.push(path);
                        }
                    }
                }
            }
        }

        let current_path = std::env::var("PATH").unwrap_or_default();
        let existing: Vec<PathBuf> = std::env::split_paths(&current_path).collect();
        let mut all_paths = extra_paths;
        all_paths.extend(existing);

        if let Ok(new_path) = std::env::join_paths(&all_paths) {
            cmd.env("PATH", new_path);
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    const PROTECTED_KEYS: &[&str] = &[
        "PI_CODING_AGENT_DIR",
        "WORKSPACE_DIR",
        "MEMORY_ROOT_DIR",
        "USER_SKILLS_DIR",
        "AGENT_HOME_DIR",
        "MEMORY_ENABLED",
        "HEARTBEAT_ENABLED",
        "CRON_ENABLED",
    ];
    for (key, value) in env_vars {
        if !PROTECTED_KEYS.contains(&key.as_str()) {
            cmd.env(key, value);
        }
    }

    let mut child = cmd.spawn().map_err(|error| {
        eprintln!("[sidecar] pi spawn FAILED: {}", error);
        format!("Failed to spawn pi: {}", error)
    })?;
    append_log_line(
        app,
        "sidecar",
        &format!("spawned pi pid={} for session {}", child.id(), session_id),
    );

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture pi stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture pi stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture pi stderr".to_string())?;

    let stderr_buf: SharedStderrBuf = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf_writer = stderr_buf.clone();
    let session_id_owned = session_id.to_string();
    let session_id_stdout = session_id_owned.clone();
    let session_id_stderr = session_id_owned.clone();
    let app_stdout = app.clone();
    let app_stderr = app.clone();
    let (ready_tx, ready_rx) = mpsc::channel::<()>();
    let ready_tx_stdout = ready_tx.clone();

    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.contains("\"type\":\"session\"")
                || trimmed.contains("\"type\": \"session\"")
            {
                signal_ready(&ready_tx_stdout);
            }
            if handle_session_line(&app_stdout, trimmed, "stdout", Some(&session_id_stdout)) {
                signal_ready(&ready_tx_stdout);
            }
        }
        let _ = app_stdout.emit(
            "agent-rpc-event",
            serde_json::json!({
                "type": "error",
                "session_id": session_id_stdout,
                "error": "Pi session process exited"
            }),
        );
    });

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(mut buf) = stderr_buf_writer.lock() {
                if buf.len() >= 10 {
                    buf.remove(0);
                }
                buf.push(trimmed.to_string());
            }
            let _ = handle_session_line(&app_stderr, trimmed, "stderr", Some(&session_id_stderr));
        }
    });

    let mut process = AgentProcess {
        child,
        stdin: Arc::new(Mutex::new(stdin)),
        session_id: session_id_owned,
        workspace,
        stderr_buf,
        last_access: Instant::now(),
    };

    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        if ready_rx.recv_timeout(Duration::from_millis(100)).is_ok() {
            mark_process_access(&mut process);
            return Ok(process);
        }

        if !is_running(&mut process) {
            let exit_info = match process.child.try_wait() {
                Ok(Some(status)) => format!(" (exit {})", status),
                _ => String::new(),
            };
            let stderr_tail = process
                .stderr_buf
                .lock()
                .ok()
                .map(|buf| buf.join(" | "))
                .unwrap_or_default();
            let detail = if stderr_tail.is_empty() {
                format!("Pi exited during startup{}", exit_info)
            } else {
                format!("Pi exited during startup{}: {}", exit_info, stderr_tail)
            };
            append_log_line(app, "sidecar", &detail);
            return Err(detail);
        }

        if Instant::now() >= deadline {
            append_log_line(app, "sidecar", "Pi session handshake timed out after 10s");
            stop_process(&mut process);
            return Err("Pi session handshake timed out".to_string());
        }
    }
}

#[tauri::command]
pub async fn ensure_pi_session(
    app: AppHandle,
    session_id: String,
    env_vars: HashMap<String, String>,
) -> Result<AgentStatus, String> {
    if session_id.trim().is_empty() {
        return Err("Session ID is required".to_string());
    }

    ensure_cleanup_thread(&app);

    {
        let mut processes = AGENT_PROCESSES.lock().unwrap();
        prune_exited_processes(&mut processes);
        if let Some(existing) = processes.get_mut(&session_id) {
            mark_process_access(existing);
            return Ok(AgentStatus {
                running: true,
                transport: "rpc-stdio".to_string(),
            });
        }
    }

    let process = spawn_pi_process(&app, &session_id, &env_vars)?;
    let mut processes = AGENT_PROCESSES.lock().unwrap();
    processes.insert(session_id, process);

    Ok(AgentStatus {
        running: true,
        transport: "rpc-stdio".to_string(),
    })
}

#[tauri::command]
pub fn agent_rpc_send(session_id: String, message: String) -> Result<(), String> {
    let mut processes = AGENT_PROCESSES.lock().unwrap();
    prune_exited_processes(&mut processes);
    let Some(process) = processes.get_mut(&session_id) else {
        return Err("Pi session is not running".to_string());
    };

    mark_process_access(process);
    let mut stdin = process.stdin.lock().unwrap();
    stdin
        .write_all(message.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to send prompt to Pi session: {}", error))
}

#[tauri::command]
pub fn interrupt_pi_session(session_id: String) -> Result<(), String> {
    let mut processes = AGENT_PROCESSES.lock().unwrap();
    prune_exited_processes(&mut processes);
    let Some(process) = processes.get_mut(&session_id) else {
        return Err("Pi session is not running".to_string());
    };

    mark_process_access(process);
    interrupt_process(&mut process.child);
    Ok(())
}

#[tauri::command]
pub fn stop_pi_session(session_id: Option<String>) -> Result<(), String> {
    let mut removed = Vec::new();

    {
        let mut processes = AGENT_PROCESSES.lock().unwrap();
        prune_exited_processes(&mut processes);

        match session_id {
            Some(ref session_id) => {
                if let Some(process) = processes.remove(session_id) {
                    removed.push(process);
                }
            }
            None => {
                removed.extend(processes.drain().map(|(_, process)| process));
            }
        }
    }

    for mut process in removed {
        stop_process(&mut process);
    }

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
    if skill_id.is_empty()
        || skill_id.contains("..")
        || skill_id.contains('/')
        || skill_id.contains('\\')
    {
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
    std::fs::remove_dir_all(&skill_dir).map_err(|e| format!("Failed to delete skill: {}", e))?;
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
    let mut processes = AGENT_PROCESSES.lock().unwrap();
    prune_exited_processes(&mut processes);

    AgentStatus {
        running: !processes.is_empty(),
        transport: "rpc-stdio".to_string(),
    }
}

#[derive(Serialize)]
pub struct FeedbackContext {
    pub app_version: String,
    pub os_info: String,
    pub log_tail: Vec<String>,
}

#[tauri::command]
pub fn get_feedback_context(app: AppHandle, tail_lines: Option<usize>) -> Result<FeedbackContext, String> {
    let n = tail_lines.unwrap_or(50);
    let mut all_lines: Vec<String> = Vec::new();

    if let Some(log_dir) = agent_log_dir(&app) {
        for i in (1..LOG_KEEP_FILES).rev() {
            let path = log_dir.join(format!("agent.log.{}", i));
            if let Ok(content) = fs::read_to_string(&path) {
                all_lines.extend(content.lines().map(String::from));
            }
        }
        let main_log = log_dir.join("agent.log");
        if let Ok(content) = fs::read_to_string(&main_log) {
            all_lines.extend(content.lines().map(String::from));
        }
    }

    let start = if all_lines.len() > n { all_lines.len() - n } else { 0 };
    let log_tail = all_lines[start..].to_vec();

    let version = app.package_info().version.to_string();
    let os_info = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);

    Ok(FeedbackContext {
        app_version: version,
        os_info,
        log_tail,
    })
}
