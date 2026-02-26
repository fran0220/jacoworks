use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

static SSE_CANCEL: LazyLock<AtomicBool> = LazyLock::new(|| AtomicBool::new(false));

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn http_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let http_method = method.parse::<reqwest::Method>().map_err(|e| e.to_string())?;
    let mut req = client.request(http_method, &url);

    for (key, value) in &headers {
        req = req.header(key, value);
    }

    if let Some(b) = body {
        if !b.is_empty() {
            req = req.body(b);
        }
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let resp_headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(HttpResponse {
        status,
        headers: resp_headers,
        body,
    })
}

#[derive(Clone, Serialize)]
struct SseEventPayload {
    event: String,
    data: String,
    id: Option<String>,
}

#[derive(Clone, Serialize)]
struct SseClosedPayload {
    error: String,
}

#[tauri::command]
pub async fn sse_connect(
    app: AppHandle,
    url: String,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    SSE_CANCEL.store(false, Ordering::SeqCst);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(&url);
    for (key, value) in &headers {
        req = req.header(key, value);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("SSE connect failed: {} {}", status, body));
    }

    let mut stream = resp.bytes_stream();

    tokio::spawn(async move {
        let mut buf = String::new();
        let mut event_type = String::new();
        let mut data_lines: Vec<String> = Vec::new();
        let mut event_id: Option<String> = None;

        let emit_closed = |app: &AppHandle, msg: String| {
            let _ = app.emit("oc-sse-closed", SseClosedPayload { error: msg });
        };

        while let Some(chunk_result) = stream.next().await {
            if SSE_CANCEL.load(Ordering::SeqCst) {
                emit_closed(&app, "cancelled".into());
                return;
            }

            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    emit_closed(&app, e.to_string());
                    return;
                }
            };

            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(newline_pos) = buf.find('\n') {
                let line = buf[..newline_pos].trim_end_matches('\r').to_string();
                buf = buf[newline_pos + 1..].to_string();

                if line.is_empty() {
                    // Blank line = dispatch event
                    if !data_lines.is_empty() {
                        let evt = if event_type.is_empty() {
                            "message".to_string()
                        } else {
                            std::mem::take(&mut event_type)
                        };
                        let data = data_lines.join("\n");
                        data_lines.clear();
                        let id = event_id.take();

                        let _ = app.emit(
                            "oc-sse-event",
                            SseEventPayload {
                                event: evt,
                                data,
                                id,
                            },
                        );
                    }
                    event_type.clear();
                } else if let Some(value) = line.strip_prefix("event:") {
                    event_type = value.trim_start().to_string();
                } else if let Some(value) = line.strip_prefix("data:") {
                    data_lines.push(value.trim_start().to_string());
                } else if let Some(value) = line.strip_prefix("id:") {
                    event_id = Some(value.trim_start().to_string());
                }
                // Lines starting with ':' are comments — ignored
            }

            if SSE_CANCEL.load(Ordering::SeqCst) {
                emit_closed(&app, "cancelled".into());
                return;
            }
        }

        emit_closed(&app, "stream ended".into());
    });

    Ok(())
}

#[tauri::command]
pub async fn sse_close() -> Result<(), String> {
    SSE_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}
