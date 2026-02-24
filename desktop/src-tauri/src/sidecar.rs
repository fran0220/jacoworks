use std::sync::Mutex;
use std::process::{Child, Command, Stdio};
use std::collections::HashMap;

static AGENT_PROCESS: std::sync::LazyLock<Mutex<Option<Child>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

static AGENT_PORT: u16 = 18789;

#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentStatus {
    pub running: bool,
    pub port: u16,
    pub url: String,
}

/// Start the local vm-agent sidecar process.
/// `agent_dir` is the absolute path to the vm-agent directory (where dist/index.js lives).
/// `env_vars` contains LLM_PROXY_URL, LLM_PROXY_KEY, etc.
#[tauri::command]
pub async fn start_agent(
    agent_dir: String,
    env_vars: HashMap<String, String>,
) -> Result<AgentStatus, String> {
    // Scope the mutex guard so it's dropped before any .await
    {
        let mut proc = AGENT_PROCESS.lock().unwrap();

        // If already running, check if still alive
        if let Some(ref mut child) = *proc {
            match child.try_wait() {
                Ok(None) => {
                    // Still running
                    return Ok(AgentStatus {
                        running: true,
                        port: AGENT_PORT,
                        url: format!("http://localhost:{}", AGENT_PORT),
                    });
                }
                _ => {
                    // Dead, clean up
                    *proc = None;
                }
            }
        }

        // Build the entry point path
        let entry = std::path::Path::new(&agent_dir).join("dist").join("index.js");
        if !entry.exists() {
            return Err(format!("Agent entry not found: {}", entry.display()));
        }

        let mut cmd = Command::new("node");
        cmd.arg("--enable-source-maps")
            .arg(entry.to_str().unwrap())
            .current_dir(&agent_dir)
            .env("PORT", AGENT_PORT.to_string())
            .env("MEMORY_ENABLED", "true")
            .env("HEARTBEAT_ENABLED", "false")
            .env("CRON_ENABLED", "false")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Set user-provided env vars (LLM_PROXY_URL, LLM_PROXY_KEY, etc.)
        for (key, value) in &env_vars {
            cmd.env(key, value);
        }

        let child = cmd.spawn().map_err(|e| format!("Failed to spawn agent: {}", e))?;
        *proc = Some(child);
    } // MutexGuard dropped here

    // Wait for health check (poll up to 10 seconds)
    let url = format!("http://localhost:{}/health", AGENT_PORT);
    let client = reqwest::Client::new();

    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return Ok(AgentStatus {
                    running: true,
                    port: AGENT_PORT,
                    url: format!("http://localhost:{}", AGENT_PORT),
                });
            }
        }
    }

    Err("Agent failed to start within 10 seconds".to_string())
}

/// Stop the local vm-agent sidecar process.
#[tauri::command]
pub fn stop_agent() -> Result<(), String> {
    let mut proc = AGENT_PROCESS.lock().unwrap();
    if let Some(ref mut child) = *proc {
        child.kill().map_err(|e| format!("Failed to kill agent: {}", e))?;
        child.wait().ok();
    }
    *proc = None;
    Ok(())
}

/// Check if the agent is running.
#[tauri::command]
pub fn agent_status() -> AgentStatus {
    let mut proc = AGENT_PROCESS.lock().unwrap();
    if let Some(ref mut child) = *proc {
        match child.try_wait() {
            Ok(None) => AgentStatus {
                running: true,
                port: AGENT_PORT,
                url: format!("http://localhost:{}", AGENT_PORT),
            },
            _ => {
                *proc = None;
                AgentStatus {
                    running: false,
                    port: AGENT_PORT,
                    url: format!("http://localhost:{}", AGENT_PORT),
                }
            }
        }
    } else {
        AgentStatus {
            running: false,
            port: AGENT_PORT,
            url: format!("http://localhost:{}", AGENT_PORT),
        }
    }
}
