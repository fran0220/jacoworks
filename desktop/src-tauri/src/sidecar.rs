use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

// ───── Memory helpers ─────────────────────────────────────────

fn memory_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("memory"))
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))
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

/// List all memory files with their content (MEMORY.md + daily/*.md).
#[tauri::command]
pub fn list_memory_files(app: AppHandle) -> Result<Vec<MemoryFileEntry>, String> {
    let root = memory_root_dir(&app)?;
    let mut entries = Vec::new();

    if !root.exists() {
        return Ok(entries);
    }

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

#[tauri::command]
pub fn get_memory_root(app: AppHandle) -> Result<String, String> {
    memory_root_dir(&app).map(|p| p.display().to_string())
}

