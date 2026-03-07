use std::collections::HashMap;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use reqwest::multipart;
use tar::{Archive, Builder};
use walkdir::WalkDir;

// ── Remote filesystem commands (cloud file channel) ──

#[derive(serde::Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(serde::Serialize)]
pub struct FileStat {
    pub exists: bool,
    pub is_dir: bool,
    pub size: u64,
}

/// Resolve and validate that a target path stays within the workspace root.
/// Returns the full canonical path or an error.
fn safe_resolve(workspace: &str, relative: &str) -> Result<std::path::PathBuf, String> {
    let root = std::path::Path::new(workspace);
    let canonical_root = dunce::canonicalize(root)
        .map_err(|e| format!("workspace root not found: {}", e))?;

    // Empty relative path means workspace root itself
    if relative.is_empty() || relative == "." {
        return Ok(canonical_root);
    }

    let joined = canonical_root.join(relative);

    // For paths that don't exist yet (writes), canonicalize the parent
    if let Some(parent) = joined.parent() {
        if parent.exists() {
            let canonical_parent = dunce::canonicalize(parent)
                .map_err(|e| format!("resolve parent: {}", e))?;
            if !canonical_parent.starts_with(&canonical_root) {
                return Err("path escapes workspace boundary".to_string());
            }
        }
    }

    // For existing paths, fully canonicalize to catch symlink escapes
    if joined.exists() {
        let canonical = dunce::canonicalize(&joined)
            .map_err(|e| format!("resolve path: {}", e))?;
        if !canonical.starts_with(&canonical_root) {
            return Err("path escapes workspace boundary (symlink)".to_string());
        }
        return Ok(canonical);
    }

    Ok(joined)
}

#[tauri::command]
pub async fn read_file_text(workspace: String, relative_path: String) -> Result<String, String> {
    let full = safe_resolve(&workspace, &relative_path)?;
    tokio::task::spawn_blocking(move || {
        std::fs::read_to_string(&full).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_file_text(workspace: String, relative_path: String, content: String) -> Result<(), String> {
    let full = safe_resolve(&workspace, &relative_path)?;
    tokio::task::spawn_blocking(move || {
        if let Some(parent) = full.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&full, &content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

const MAX_LIST_ENTRIES: usize = 5000;

#[tauri::command]
pub async fn list_directory(workspace: String, relative_path: String, recursive: bool) -> Result<Vec<FileEntry>, String> {
    let full = safe_resolve(&workspace, &relative_path)?;
    tokio::task::spawn_blocking(move || {
        if !full.is_dir() {
            return Err("not a directory".to_string());
        }
        let mut entries = Vec::new();
        list_dir_inner(&full, &full, recursive, &mut entries)?;
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn list_dir_inner(
    root: &std::path::Path,
    dir: &std::path::Path,
    recursive: bool,
    entries: &mut Vec<FileEntry>,
) -> Result<(), String> {
    if entries.len() >= MAX_LIST_ENTRIES {
        return Ok(());
    }
    let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in read_dir {
        if entries.len() >= MAX_LIST_ENTRIES {
            break;
        }
        let entry = entry.map_err(|e| e.to_string())?;
        // Use symlink_metadata to detect symlinks without following them
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files, common large directories, and symlinks
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
        {
            continue;
        }

        let rel_path = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(&entry.path())
            .to_string_lossy()
            .replace('\\', "/");

        entries.push(FileEntry {
            name,
            path: rel_path,
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });

        if recursive && metadata.is_dir() {
            list_dir_inner(root, &entry.path(), true, entries)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn file_stat(workspace: String, relative_path: String) -> Result<FileStat, String> {
    let full = safe_resolve(&workspace, &relative_path)?;
    tokio::task::spawn_blocking(move || match std::fs::metadata(&full) {
        Ok(meta) => Ok(FileStat {
            exists: true,
            is_dir: meta.is_dir(),
            size: meta.len(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileStat {
            exists: false,
            is_dir: false,
            size: 0,
        }),
        Err(e) => Err(e.to_string()),
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Existing tar/upload/download commands ──

#[tauri::command]
pub async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .set_title("Select Project Directory")
        .blocking_pick_folder();

    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn tar_directory(path: String) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        let mut buf = Vec::new();
        {
            let gz = GzEncoder::new(&mut buf, Compression::fast());
            let mut tar = Builder::new(gz);

            let base = std::path::Path::new(&path);

            for entry in WalkDir::new(&path)
                .into_iter()
                .filter_entry(|e| {
                    let name = e.file_name().to_string_lossy();
                    !matches!(
                        name.as_ref(),
                        ".git"
                            | "node_modules"
                            | ".DS_Store"
                            | "__pycache__"
                            | ".env"
                            | "target"
                    )
                })
            {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };

                let full_path = entry.path();
                let relative = full_path.strip_prefix(base).unwrap_or(full_path);

                if full_path == base {
                    continue;
                }

                if entry.file_type().is_file() {
                    tar.append_path_with_name(full_path, relative)
                        .map_err(|e| e.to_string())?;
                } else if entry.file_type().is_dir() {
                    tar.append_dir(relative, full_path)
                        .map_err(|e| e.to_string())?;
                }
            }

            let gz = tar.into_inner().map_err(|e| e.to_string())?;
            gz.finish().map_err(|e| e.to_string())?;
        }
        Ok(buf)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn extract_tar(data: Vec<u8>, dest: String) -> Result<u32, String> {
    tokio::task::spawn_blocking(move || {
        let gz = GzDecoder::new(&data[..]);
        let mut archive = Archive::new(gz);
        let mut count: u32 = 0;

        let dest_path = std::path::Path::new(&dest);

        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;

            let path = entry.path().map_err(|e| e.to_string())?;
            let full = dest_path.join(&path);
            if !full.starts_with(dest_path) {
                continue;
            }

            entry.unpack_in(dest_path).map_err(|e| e.to_string())?;
            count += 1;
        }

        Ok(count)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn upload_cowork(
    session_id: String,
    folder_path: String,
    gateway_url: String,
    token: String,
) -> Result<HashMap<String, serde_json::Value>, String> {
    let tar_data = tar_directory(folder_path).await?;

    let part = multipart::Part::bytes(tar_data)
        .file_name("archive.tar.gz")
        .mime_str("application/gzip")
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new().part("file", part);

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/cowork/{}/upload", gateway_url, session_id))
        .header("Authorization", format!("Bearer {}", token))
        .multipart(form)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("upload failed ({}): {}", status, body));
    }

    resp.json::<HashMap<String, serde_json::Value>>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_cowork(
    session_id: String,
    local_folder: String,
    gateway_url: String,
    token: String,
) -> Result<u32, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(format!(
            "{}/api/cowork/{}/download",
            gateway_url, session_id
        ))
        .header("Authorization", format!("Bearer {}", token))
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().as_u16() == 204 {
        return Ok(0);
    }

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("download failed ({}): {}", status, body));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    extract_tar(bytes.to_vec(), local_folder).await
}
