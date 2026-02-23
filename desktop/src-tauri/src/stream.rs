use std::collections::HashMap;
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

static ABORT_MAP: std::sync::LazyLock<Mutex<HashMap<u32, tokio::sync::oneshot::Sender<()>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Serialize, Deserialize)]
pub struct StreamResponse {
    pub request_id: u32,
    pub status: u16,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChunkPayload {
    pub request_id: u32,
    pub chunk: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EndPayload {
    pub request_id: u32,
    pub status: u32,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn stream_fetch(
    app: AppHandle,
    request_id: u32,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<StreamResponse, String> {

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let http_method = method
        .parse::<reqwest::Method>()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(http_method, &url);

    for (key, value) in &headers {
        req = req.header(key, value);
    }

    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    let resp_headers: HashMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let stream_response = StreamResponse {
        request_id,
        status,
        headers: resp_headers,
    };

    // Set up abort channel
    let (abort_tx, mut abort_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut map = ABORT_MAP.lock().unwrap();
        map.insert(request_id, abort_tx);
    }

    // Spawn background task to stream chunks
    tokio::spawn(async move {
        let mut stream = resp.bytes_stream();

        let end_payload = loop {
            tokio::select! {
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let payload = ChunkPayload {
                                request_id,
                                chunk: bytes.to_vec(),
                            };
                            let _ = app.emit("stream-response", &payload);
                        }
                        Some(Err(e)) => {
                            break EndPayload {
                                request_id,
                                status: 1,
                                error: Some(e.to_string()),
                            };
                        }
                        None => {
                            break EndPayload {
                                request_id,
                                status: 0,
                                error: None,
                            };
                        }
                    }
                }
                _ = &mut abort_rx => {
                    break EndPayload {
                        request_id,
                        status: 1,
                        error: Some("aborted".to_string()),
                    };
                }
            }
        };

        let _ = app.emit("stream-end", &end_payload);
        ABORT_MAP.lock().unwrap().remove(&request_id);
    });

    Ok(stream_response)
}

#[tauri::command]
pub fn stream_abort(request_id: u32) -> Result<(), String> {
    let mut map = ABORT_MAP.lock().unwrap();
    if let Some(tx) = map.remove(&request_id) {
        let _ = tx.send(());
        Ok(())
    } else {
        Err(format!("request {} not found or already completed", request_id))
    }
}

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

    Ok(HttpResponse { status, headers: resp_headers, body })
}
