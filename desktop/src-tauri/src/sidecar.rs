use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

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

// ───── Skills sync helpers ────────────────────────────────────

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
    let dir_entries = std::fs::read_dir(current).map_err(|e| format!("Failed to read dir: {}", e))?;

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

// ───── User skills management ─────────────────────────────────

fn user_skills_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("skills"))
        .map_err(|error| format!("Failed to resolve app data directory: {}", error))
}

fn validate_skill_id(skill_id: &str) -> Result<(), String> {
    if skill_id.is_empty()
        || skill_id.contains("..")
        || skill_id.contains('/')
        || skill_id.contains('\\')
    {
        return Err("Invalid skill id".to_string());
    }
    Ok(())
}

fn ensure_relative_skill_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() {
        return Err("Skill file path must be relative".to_string());
    }
    if candidate
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Skill file path cannot contain '..'".to_string());
    }
    Ok(candidate)
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
pub fn save_user_skill(
    app: AppHandle,
    skill_id: String,
    files: Vec<MemoryFileEntry>,
) -> Result<usize, String> {
    validate_skill_id(&skill_id)?;

    let dir = user_skills_dir(&app)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create skills directory: {}", e))?;

    let skill_dir = dir.join(&skill_id);
    if skill_dir.exists() {
        std::fs::remove_dir_all(&skill_dir)
            .map_err(|e| format!("Failed to replace existing skill: {}", e))?;
    }
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;

    let mut written = 0usize;
    for file in &files {
        let rel = ensure_relative_skill_path(&file.path)?;
        let target = skill_dir.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create skill subdirectory: {}", e))?;
        }
        std::fs::write(&target, &file.content)
            .map_err(|e| format!("Failed to write skill file {}: {}", file.path, e))?;
        written += 1;
    }

    Ok(written)
}

#[tauri::command]
pub fn list_user_skills(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = user_skills_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| format!("Failed to list skills: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read skill entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('.') {
            continue;
        }
        skills.push(id);
    }

    skills.sort();
    Ok(skills)
}

#[tauri::command]
pub fn delete_user_skill(app: AppHandle, skill_id: String) -> Result<(), String> {
    validate_skill_id(&skill_id)?;

    let dir = user_skills_dir(&app)?;
    let skill_dir = dir.join(&skill_id);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", skill_id));
    }

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
    validate_skill_id(&skill_id)?;

    let dir = user_skills_dir(&app)?;
    let skill_dir = dir.join(&skill_id);
    if !skill_dir.exists() {
        if dir.exists() {
            return tauri_plugin_opener::reveal_item_in_dir(&dir).map_err(|e| e.to_string());
        }
        return Err(format!("Skill '{}' not found", skill_id));
    }
    tauri_plugin_opener::reveal_item_in_dir(&skill_dir).map_err(|e| e.to_string())
}
