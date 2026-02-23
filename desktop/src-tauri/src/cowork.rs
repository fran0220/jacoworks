use std::collections::HashMap;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use reqwest::multipart;
use tar::{Archive, Builder};
use walkdir::WalkDir;

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
