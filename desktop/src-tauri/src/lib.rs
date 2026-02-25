mod cowork;
mod sidecar;
mod stream;

use std::io::Read;
use std::path::{Path, PathBuf};
use base64::Engine as _;

fn allowed_roots(workspace: Option<&str>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(ws) = workspace {
        if !ws.is_empty() {
            roots.push(PathBuf::from(ws));
        }
    }
    if let Some(agent_ws) = sidecar::agent_workspace() {
        roots.push(agent_ws);
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    roots
}

fn validate_resolved_path(path: &Path, workspace: Option<&str>) -> Result<(), String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("Cannot access path: {}", e))?;

    let in_scope = allowed_roots(workspace)
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| canonical_path.starts_with(root));

    if in_scope {
        Ok(())
    } else {
        Err("Path is outside allowed workspace scope".to_string())
    }
}

fn resolve_scoped_path(path: &str, workspace: Option<&str>) -> Result<PathBuf, String> {
    let resolved = resolve_path(path, workspace);
    validate_resolved_path(&resolved, workspace)?;
    Ok(resolved)
}

fn read_file_prefix(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Read error: {}", e))?;
    let mut reader = file.take(limit as u64);
    let mut bytes = Vec::with_capacity(limit.min(16 * 1024));
    reader
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Read error: {}", e))?;
    Ok(bytes)
}

fn resolve_path(path: &str, workspace: Option<&str>) -> PathBuf {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        return p;
    }
    // 1) Explicit workspace from session
    if let Some(ws) = workspace {
        if !ws.is_empty() {
            let full = PathBuf::from(ws).join(path);
            if full.exists() {
                return full;
            }
        }
    }
    // 2) Fallback: running agent's workspace directory
    if let Some(agent_ws) = sidecar::agent_workspace() {
        let full = agent_ws.join(path);
        if full.exists() {
            return full;
        }
    }
    // 3) Fallback: process CWD
    if let Ok(cwd) = std::env::current_dir() {
        let full = cwd.join(path);
        if full.exists() {
            return full;
        }
    }
    p
}

/// Reveal file in system file manager (Finder / Explorer / Nautilus).
/// Uses tauri_plugin_opener free function — no ACL scope check.
#[tauri::command]
fn reveal_in_finder(path: String, workspace: Option<String>) -> Result<(), String> {
    let full = resolve_scoped_path(&path, workspace.as_deref())?;
    eprintln!("[file-card] reveal_in_finder: {}", full.display());
    tauri_plugin_opener::reveal_item_in_dir(&full).map_err(|e| e.to_string())
}

/// Open file with system default app.
/// Uses `open` crate directly — cross-platform, no ACL scope check.
#[tauri::command]
fn open_file_default(path: String, workspace: Option<String>) -> Result<(), String> {
    let full = resolve_scoped_path(&path, workspace.as_deref())?;
    eprintln!("[file-card] open_file_default: {}", full.display());
    open::that(&full).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct FilePreview {
    path: String,
    name: String,
    ext: String,
    size: u64,
    category: String,
    content: Option<String>,
    language: Option<String>,
}

fn detect_category(ext: &str) -> &'static str {
    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp" => "image",
        "js" | "mjs" | "ts" | "tsx" | "jsx" | "py" | "go" | "rs"
        | "json" | "yaml" | "yml" | "toml" | "html" | "css" | "sql"
        | "sh" | "xml" | "csv" | "log" => "code",
        "md" => "markdown",
        "txt" => "text",
        "docx" => "docx",
        "xlsx" | "xls" => "xlsx",
        _ => "binary",
    }
}

fn ext_to_language(ext: &str) -> Option<&'static str> {
    match ext {
        "js" | "mjs" | "jsx" => Some("javascript"),
        "ts" | "tsx" => Some("typescript"),
        "py" => Some("python"),
        "go" => Some("go"),
        "rs" => Some("rust"),
        "json" => Some("json"),
        "yaml" | "yml" => Some("yaml"),
        "toml" => Some("yaml"),
        "html" => Some("xml"),
        "css" => Some("css"),
        "sql" => Some("sql"),
        "sh" => Some("bash"),
        "xml" => Some("xml"),
        "csv" | "log" => Some("plaintext"),
        _ => None,
    }
}

fn ext_to_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
fn preview_file(path: String, workspace: Option<String>) -> Result<FilePreview, String> {
    let full = resolve_scoped_path(&path, workspace.as_deref())?;
    let meta = std::fs::metadata(&full).map_err(|e| format!("Cannot access file: {}", e))?;

    let name = full
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let ext = full
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let category = detect_category(&ext).to_string();
    let size = meta.len();

    let (content, language) = match category.as_str() {
        "image" => {
            if size > 20 * 1024 * 1024 {
                (None, None)
            } else {
                let bytes = std::fs::read(&full).map_err(|e| format!("Read error: {}", e))?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                let mime = ext_to_mime(&ext);
                (Some(format!("data:{};base64,{}", mime, b64)), None)
            }
        }
        "code" | "markdown" | "text" => {
            let max_size = 200 * 1024usize;
            let bytes = read_file_prefix(&full, max_size + 1)?;
            let text = if bytes.len() > max_size {
                let truncated = String::from_utf8_lossy(&bytes[..max_size]);
                format!("{}\n\n⸺ 文件过大，仅显示前 200KB ⸺", truncated)
            } else {
                String::from_utf8_lossy(&bytes).to_string()
            };
            let lang = ext_to_language(&ext).map(|s| s.to_string());
            (Some(text), lang)
        }
        "docx" | "xlsx" => {
            if size > 50 * 1024 * 1024 {
                (None, None)
            } else {
                let bytes = std::fs::read(&full).map_err(|e| format!("Read error: {}", e))?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                (Some(b64), None)
            }
        }
        _ => (None, None),
    };

    Ok(FilePreview {
        path: full.display().to_string(),
        name,
        ext: ext.to_uppercase(),
        size,
        category,
        content,
        language,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            stream::http_fetch,
            cowork::select_directory,
            cowork::tar_directory,
            cowork::extract_tar,
            cowork::upload_cowork,
            cowork::download_cowork,
            sidecar::start_agent,
            sidecar::agent_rpc_send,
            sidecar::stop_agent,
            sidecar::agent_status,
            sidecar::get_memory_stats,
            sidecar::clear_memory,
            reveal_in_finder,
            open_file_default,
            preview_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
