mod cowork;
mod sidecar;
mod stream;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use base64::Engine as _;
use flate2::read::GzDecoder;
use serde_json::json;
use tar::Archive as TarArchive;
use zip::read::ZipArchive;

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

/// For user-initiated read-only operations (preview, open, reveal):
/// absolute paths that exist are allowed directly — the file was created by the agent
/// and the user explicitly clicked a button to access it.
fn resolve_read_path(path: &str, workspace: Option<&str>) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        return p
            .canonicalize()
            .map_err(|e| format!("Cannot access path: {}", e));
    }
    resolve_scoped_path(path, workspace)
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
    let full = resolve_read_path(&path, workspace.as_deref())?;
    eprintln!("[file-card] reveal_in_finder: {}", full.display());
    tauri_plugin_opener::reveal_item_in_dir(&full).map_err(|e| e.to_string())
}

/// Open file with system default app.
/// Uses `open` crate directly — cross-platform, no ACL scope check.
#[tauri::command]
fn open_file_default(path: String, workspace: Option<String>) -> Result<(), String> {
    let full = resolve_read_path(&path, workspace.as_deref())?;
    eprintln!("[file-card] open_file_default: {}", full.display());
    open::that(&full).map_err(|e| e.to_string())
}

#[tauri::command]
fn resolve_file_path(path: String, workspace: Option<String>) -> Result<String, String> {
    let full = resolve_read_path(&path, workspace.as_deref())?;
    Ok(full.display().to_string())
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
    entries: Option<Vec<String>>,
    metadata: Option<serde_json::Value>,
}

fn detect_category(name: &str, ext: &str) -> &'static str {
    let lower_name = name.to_lowercase();
    if lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") {
        return "archive";
    }

    match ext {
        "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "bmp" => "image",
        "pdf" => "pdf",
        "mp4" | "mov" | "m4v" | "webm" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" => "audio",
        "zip" | "tar" => "archive",
        "fig" | "sketch" | "psd" => "design",
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

fn display_ext(name: &str, ext: &str) -> String {
    let lower_name = name.to_lowercase();
    if lower_name.ends_with(".tar.gz") {
        "TAR.GZ".to_string()
    } else if lower_name.ends_with(".tgz") {
        "TGZ".to_string()
    } else {
        ext.to_uppercase()
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

fn list_zip_entries(path: &Path, max_entries: usize) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Read error: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("ZIP parse error: {}", e))?;
    let total = archive.len();
    let mut entries = Vec::new();

    for idx in 0..total.min(max_entries) {
        let entry = archive
            .by_index(idx)
            .map_err(|e| format!("ZIP entry error: {}", e))?;
        entries.push(entry.name().to_string());
    }

    if total > max_entries {
        entries.push(format!("... and {} more entries", total - max_entries));
    }

    Ok(entries)
}

fn list_tar_entries(path: &Path, max_entries: usize) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Read error: {}", e))?;
    let mut archive = TarArchive::new(file);
    let mut entries = Vec::new();
    let mut total = 0usize;

    for item in archive
        .entries()
        .map_err(|e| format!("TAR parse error: {}", e))?
    {
        let entry = item.map_err(|e| format!("TAR entry error: {}", e))?;
        total += 1;
        if entries.len() < max_entries {
            entries.push(entry.path().map_err(|e| format!("TAR path error: {}", e))?.display().to_string());
        }
    }

    if total > max_entries {
        entries.push(format!("... and {} more entries", total - max_entries));
    }

    Ok(entries)
}

fn list_targz_entries(path: &Path, max_entries: usize) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Read error: {}", e))?;
    let gz = GzDecoder::new(file);
    let mut archive = TarArchive::new(gz);
    let mut entries = Vec::new();
    let mut total = 0usize;

    for item in archive
        .entries()
        .map_err(|e| format!("TAR.GZ parse error: {}", e))?
    {
        let entry = item.map_err(|e| format!("TAR.GZ entry error: {}", e))?;
        total += 1;
        if entries.len() < max_entries {
            entries.push(entry.path().map_err(|e| format!("TAR.GZ path error: {}", e))?.display().to_string());
        }
    }

    if total > max_entries {
        entries.push(format!("... and {} more entries", total - max_entries));
    }

    Ok(entries)
}

fn archive_total_count(entries: &[String]) -> usize {
    if let Some(last) = entries.last() {
        if let Some(extra_text) = last
            .strip_prefix("... and ")
            .and_then(|text| text.strip_suffix(" more entries"))
        {
            if let Ok(extra) = extra_text.parse::<usize>() {
                return entries.len().saturating_sub(1) + extra;
            }
        }
    }
    entries.len()
}

fn parse_psd_dimensions(path: &Path) -> Option<(u32, u32)> {
    let bytes = read_file_prefix(path, 26).ok()?;
    if bytes.len() < 22 || &bytes[0..4] != b"8BPS" {
        return None;
    }
    let height = u32::from_be_bytes([bytes[14], bytes[15], bytes[16], bytes[17]]);
    let width = u32::from_be_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]);
    Some((width, height))
}

fn file_modified_unix(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

#[tauri::command]
fn preview_file(path: String, workspace: Option<String>) -> Result<FilePreview, String> {
    let full = resolve_read_path(&path, workspace.as_deref())?;
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

    let category = detect_category(&name, &ext).to_string();
    let size = meta.len();

    let mut entries: Option<Vec<String>> = None;
    let mut metadata: Option<serde_json::Value> = None;

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
        "pdf" | "video" | "audio" => (None, None),
        "archive" => {
            let lower_name = name.to_lowercase();
            let archive_entries = if ext == "zip" {
                list_zip_entries(&full, 400)?
            } else if ext == "tar" {
                list_tar_entries(&full, 400)?
            } else if lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") {
                list_targz_entries(&full, 400)?
            } else {
                Vec::new()
            };

            metadata = Some(json!({
                "entryCount": archive_total_count(&archive_entries),
                "truncated": archive_entries.last().map(|v| v.starts_with("... and ")).unwrap_or(false),
            }));
            entries = Some(archive_entries);
            (None, None)
        }
        "design" => {
            let mut design_meta = json!({
                "format": ext.to_uppercase(),
                "modifiedAt": file_modified_unix(&meta),
            });

            if ext == "psd" {
                if let Some((width, height)) = parse_psd_dimensions(&full) {
                    design_meta["width"] = json!(width);
                    design_meta["height"] = json!(height);
                }
            }

            if ext == "sketch" {
                if let Ok(zip_entries) = list_zip_entries(&full, 1) {
                    let truncated = zip_entries
                        .last()
                        .map(|v| v.starts_with("... and "))
                        .unwrap_or(false);
                    design_meta["isArchivePackage"] = json!(true);
                    design_meta["entriesSampled"] = json!(zip_entries.len());
                    design_meta["truncated"] = json!(truncated);
                }
            }

            metadata = Some(design_meta);
            (None, None)
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
        ext: display_ext(&path, &ext),
        size,
        category,
        content,
        language,
        entries,
        metadata,
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
            sidecar::get_user_skills_dir,
            sidecar::delete_user_skill,
            sidecar::reveal_user_skill,
            reveal_in_finder,
            open_file_default,
            resolve_file_path,
            preview_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
