mod db;
mod sidecar;
mod stream;

use base64::Engine as _;
use flate2::read::GzDecoder;
use serde_json::json;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tar::Archive as TarArchive;
use zip::read::ZipArchive;

/// Windows-safe canonicalize: strips problematic `\\?\` prefixes.
fn safe_canonicalize(path: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(path)
}

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
    let canonical_path =
        safe_canonicalize(path).map_err(|e| format!("Cannot access path: {}", e))?;

    let in_scope = allowed_roots(workspace)
        .into_iter()
        .filter_map(|root| safe_canonicalize(&root).ok())
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
///
/// When an absolute (or tilde-expanded) path doesn't exist on disk, we fall back to
/// searching by filename in the agent workspace / session workspace / CWD, because
/// the LLM may hallucinate an absolute path while the file actually lives in the
/// agent's default working directory.
fn resolve_read_path(path: &str, workspace: Option<&str>) -> Result<PathBuf, String> {
    // Expand tilde before checking absolute
    let effective = expand_tilde(path).unwrap_or_else(|| PathBuf::from(path));

    if effective.is_absolute() {
        if let Ok(canonical) = safe_canonicalize(&effective) {
            return Ok(canonical);
        }
        // Absolute path doesn't exist — try the filename in known workspaces
        if let Some(name) = effective.file_name() {
            let name_str = name.to_string_lossy();
            let fallback = resolve_path(&name_str, workspace);
            if fallback.exists() {
                return safe_canonicalize(&fallback)
                    .map_err(|e| format!("Cannot access path: {}", e));
            }
        }
        return Err(format!(
            "Cannot access path: No such file or directory (os error 2)"
        ));
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

/// Expand leading `~` or `~/` (or `~\` on Windows) to the user's home directory.
fn expand_tilde(path: &str) -> Option<PathBuf> {
    if path == "~" {
        return dirs::home_dir();
    }
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        return dirs::home_dir().map(|home| home.join(rest));
    }
    None
}

fn resolve_path(path: &str, workspace: Option<&str>) -> PathBuf {
    // 0) Tilde expansion
    if let Some(expanded) = expand_tilde(path) {
        return expanded;
    }
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
    // 4) Fallback: user home directory
    if let Some(home) = dirs::home_dir() {
        let full = home.join(path);
        if full.exists() {
            return full;
        }
    }
    p
}

/// Return (and auto-create) the local sync root directory: `~/Documents/JAcoworks`.
/// Container files are synced into per-session subdirectories under this root.
#[tauri::command]
fn ensure_default_workspace() -> Result<String, String> {
    let doc_dir = dirs::document_dir().ok_or("Cannot resolve Documents directory")?;
    let workspace = doc_dir.join("JAcoworks");
    if !workspace.exists() {
        std::fs::create_dir_all(&workspace)
            .map_err(|e| format!("Failed to create workspace: {}", e))?;
    }
    workspace
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

/// Create (and return) a session-specific sync subdirectory: `{sync_root}/{session_id}/`.
#[tauri::command]
fn ensure_session_sync_dir(sync_root: String, session_id: String) -> Result<String, String> {
    // Sanitize session_id to prevent path traversal
    if session_id.contains('/') || session_id.contains('\\') || session_id.contains("..") {
        return Err("Invalid session ID".to_string());
    }
    let dir = PathBuf::from(&sync_root).join(&session_id);
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create session sync dir: {}", e))?;
    }
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path encoding".to_string())
}

#[tauri::command]
async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .set_title("Select Project Directory")
        .blocking_pick_folder();

    Ok(path.map(|p| p.to_string()))
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

#[tauri::command]
fn read_file_base64(
    path: String,
    workspace: Option<String>,
    max_mb: Option<u32>,
) -> Result<String, String> {
    let full = resolve_read_path(&path, workspace.as_deref())?;
    let limit = (max_mb.unwrap_or(20) as u64) * 1024 * 1024;
    let meta = std::fs::metadata(&full).map_err(|e| format!("Cannot access file: {}", e))?;
    if meta.len() > limit {
        return Err(format!(
            "File too large: {} bytes (limit {}MB)",
            meta.len(),
            limit / (1024 * 1024)
        ));
    }

    let bytes = std::fs::read(&full).map_err(|e| format!("Read error: {}", e))?;
    let ext = full
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = ext_to_mime(&ext);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
fn write_file_base64(
    path: String,
    data: String,
    workspace: Option<String>,
) -> Result<String, String> {
    // data comes as "data:image/png;base64,xxxx" or raw base64
    let b64_data = if let Some(pos) = data.find(",") {
        &data[pos + 1..]
    } else {
        &data
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64_data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    // Resolve path relative to workspace
    let full = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        let ws = workspace.as_deref().unwrap_or(".");
        PathBuf::from(ws).join(&path)
    };

    // Ensure parent directory exists
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create directory: {}", e))?;
    }

    std::fs::write(&full, &bytes)
        .map_err(|e| format!("Write error: {}", e))?;

    // Return the absolute path
    let abs = safe_canonicalize(&full).unwrap_or(full);
    Ok(abs.to_string_lossy().to_string())
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

#[derive(serde::Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    ext: String,
    category: String,
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
        "js" | "mjs" | "ts" | "tsx" | "jsx" | "py" | "go" | "rs" | "json" | "yaml" | "yml"
        | "toml" | "html" | "css" | "sql" | "sh" | "xml" | "log" => "code",
        "csv" => "csv",
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
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "m4v" => "video/x-m4v",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
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
            entries.push(
                entry
                    .path()
                    .map_err(|e| format!("TAR path error: {}", e))?
                    .display()
                    .to_string(),
            );
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
            entries.push(
                entry
                    .path()
                    .map_err(|e| format!("TAR.GZ path error: {}", e))?
                    .display()
                    .to_string(),
            );
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
        "code" | "markdown" | "text" | "csv" => {
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

#[tauri::command]
fn list_directory(path: String, workspace: Option<String>) -> Result<Vec<DirEntry>, String> {
    let full = resolve_read_path(&path, workspace.as_deref())?;
    if !full.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut entries: Vec<DirEntry> = Vec::new();
    let read_dir = std::fs::read_dir(&full).map_err(|e| format!("Cannot read directory: {}", e))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        let ext = if is_dir {
            String::new()
        } else {
            entry
                .path()
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase()
        };
        let category = if is_dir {
            "directory".to_string()
        } else {
            detect_category(&name, &ext).to_string()
        };
        entries.push(DirEntry {
            path: entry.path().display().to_string(),
            name,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            ext,
            category,
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[derive(serde::Serialize)]
pub struct ImportedFile {
    name: String,
    /// Relative path from workspace, e.g. "_attachments/report.pdf"
    path: String,
    size: u64,
}

#[derive(serde::Serialize)]
pub struct ImportResult {
    imported: Vec<ImportedFile>,
    warnings: Vec<String>,
}

const IMPORT_FILE_SIZE_LIMIT: u64 = 200 * 1024 * 1024;

fn sanitize_import_file_name(original_name: &str) -> String {
    // Sanitize incoming names to prevent path traversal and Windows-illegal filenames.
    let safe_name = original_name
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim_start_matches('.')
        .trim_end_matches(['.', ' '])
        .to_string();
    if safe_name.is_empty() {
        return "unnamed".to_string();
    }

    // Reject Windows reserved device names.
    let stem_upper = Path::new(&safe_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_uppercase();
    if matches!(
        stem_upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        format!("_{}", safe_name)
    } else {
        safe_name
    }
}

fn copy_files_to_attachments(sources: Vec<PathBuf>, workspace: &str) -> ImportResult {
    let attachments_dir = PathBuf::from(workspace).join("_attachments");
    let mut imported = Vec::with_capacity(sources.len());
    let mut warnings = Vec::new();

    if let Err(e) = std::fs::create_dir_all(&attachments_dir) {
        warnings.push(format!("Failed to create _attachments directory: {}", e));
        return ImportResult { imported, warnings };
    }

    for source in sources {
        let source_meta = match std::fs::metadata(&source) {
            Ok(meta) => meta,
            Err(e) => {
                warnings.push(format!(
                    "Skipped {}: cannot read metadata ({})",
                    source.display(),
                    e
                ));
                continue;
            }
        };

        if source_meta.len() > IMPORT_FILE_SIZE_LIMIT {
            let name = source
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            warnings.push(format!(
                "Skipped {}: file size {} bytes exceeds 200MB limit",
                name,
                source_meta.len()
            ));
            continue;
        }

        let original_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unnamed");
        let safe_name = sanitize_import_file_name(original_name);

        let stem = Path::new(&safe_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&safe_name)
            .to_string();
        let ext = Path::new(&safe_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();

        let mut dest = attachments_dir.join(&safe_name);
        let mut counter = 1u32;
        while dest.exists() {
            dest = attachments_dir.join(format!("{}-{}{}", stem, counter, ext));
            counter += 1;
        }

        if let Err(e) = std::fs::copy(&source, &dest) {
            warnings.push(format!("Failed to copy {}: {}", source.display(), e));
            continue;
        }

        let final_name = dest
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&safe_name)
            .to_string();

        imported.push(ImportedFile {
            name: final_name.clone(),
            path: format!("_attachments/{}", final_name),
            size: source_meta.len(),
        });
    }

    ImportResult { imported, warnings }
}

#[tauri::command]
async fn import_files_native(
    app: tauri::AppHandle,
    workspace: String,
) -> Result<ImportResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_title("选择文件")
        .blocking_pick_files();

    let Some(files) = picked else {
        return Ok(ImportResult {
            imported: Vec::new(),
            warnings: Vec::new(),
        });
    };

    let mut sources = Vec::with_capacity(files.len());
    let mut warnings = Vec::new();

    for file in files {
        match file.into_path() {
            Ok(path) => sources.push(path),
            Err(_) => {
                warnings.push("Skipped a file that cannot be resolved to a local path".to_string());
            }
        }
    }

    let mut result = copy_files_to_attachments(sources, &workspace);
    if !warnings.is_empty() {
        warnings.extend(result.warnings);
        result.warnings = warnings;
    }

    Ok(result)
}

#[tauri::command]
fn import_files_by_paths(paths: Vec<String>, workspace: String) -> Result<ImportResult, String> {
    let sources: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    Ok(copy_files_to_attachments(sources, &workspace))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            db::db_init(app.handle().clone()).expect("Failed to initialize local database");

            // Open devtools in debug builds or when JACOWORKS_DEVTOOLS=1
            #[cfg(feature = "devtools")]
            {
                use tauri::Manager;
                let open_devtools = cfg!(debug_assertions)
                    || std::env::var("JACOWORKS_DEVTOOLS").unwrap_or_default() == "1";
                if open_devtools {
                    if let Some(window) = app.get_webview_window("main") {
                        window.open_devtools();
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            stream::http_fetch,
            stream::sse_connect,
            stream::sse_close,
            select_directory,
            sidecar::start_agent,
            sidecar::agent_rpc_send,
            sidecar::stop_agent,
            sidecar::agent_status,
            sidecar::get_memory_stats,
            sidecar::clear_memory,
            sidecar::list_memory_files,
            sidecar::write_memory_files,
            sidecar::get_memory_root,
            sidecar::list_skill_files,
            sidecar::get_user_skills_dir,
            sidecar::delete_user_skill,
            sidecar::reveal_user_skill,
            ensure_default_workspace,
            ensure_session_sync_dir,
            reveal_in_finder,
            open_file_default,
            resolve_file_path,
            read_file_base64,
            write_file_base64,
            preview_file,
            list_directory,
            import_files_native,
            import_files_by_paths,
            db::db_init,
            db::db_list_sessions,
            db::db_get_session,
            db::db_create_session,
            db::db_append_message,
            db::db_set_messages,
            db::db_update_session_meta,
            db::db_delete_session,
            db::db_get_dirty_sessions,
            db::db_mark_synced,
            db::db_mark_syncing,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|_app, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            let _ = sidecar::stop_agent();
        }
    });
}
