use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use once_cell::sync::OnceCell;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json;
use tauri::Manager;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn get_db() -> Result<std::sync::MutexGuard<'static, Connection>, String> {
    DB.get()
        .ok_or_else(|| "Database not initialized".to_string())?
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))
}

#[tauri::command]
pub fn db_init(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let db_path = data_dir.join("jacoworks.db");
    let conn =
        Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '新会话',
            type TEXT NOT NULL DEFAULT 'cowork',
            model TEXT NOT NULL DEFAULT '',
            workspace_path TEXT NOT NULL DEFAULT '',
            anonymous INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'dirty'
        );

        CREATE TABLE IF NOT EXISTS messages (
            session_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            blocks_json TEXT,
            files_json TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (session_id, seq),
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
        ",
    )
    .map_err(|e| format!("Failed to run migrations: {}", e))?;

    DB.set(Mutex::new(conn))
        .map_err(|_| "Database already initialized".to_string())?;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct SessionRow {
    id: String,
    title: String,
    #[serde(rename = "type")]
    session_type: String,
    model: String,
    workspace_path: String,
    anonymous: bool,
    created_at: i64,
    updated_at: i64,
    message_count: i64,
    sync_status: String,
}

#[tauri::command]
pub fn db_list_sessions() -> Result<Vec<SessionRow>, String> {
    let conn = get_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.type, s.model, s.workspace_path, s.anonymous,
                    s.created_at, s.updated_at, s.sync_status,
                    (SELECT COUNT(*) FROM messages WHERE session_id = s.id) AS message_count
             FROM sessions s
             ORDER BY s.updated_at DESC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SessionRow {
                id: row.get(0)?,
                title: row.get(1)?,
                session_type: row.get(2)?,
                model: row.get(3)?,
                workspace_path: row.get(4)?,
                anonymous: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                sync_status: row.get(8)?,
                message_count: row.get(9)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(result)
}

#[derive(serde::Serialize)]
pub struct MessageRow {
    seq: i64,
    role: String,
    content: String,
    blocks_json: Option<String>,
    files_json: Option<String>,
    created_at: i64,
}

#[derive(serde::Serialize)]
pub struct FullSessionRow {
    id: String,
    title: String,
    #[serde(rename = "type")]
    session_type: String,
    model: String,
    workspace_path: String,
    anonymous: bool,
    created_at: i64,
    updated_at: i64,
    sync_status: String,
    messages: Vec<MessageRow>,
}

#[tauri::command]
pub fn db_get_session(session_id: String) -> Result<Option<FullSessionRow>, String> {
    let conn = get_db()?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, type, model, workspace_path, anonymous,
                    created_at, updated_at, sync_status
             FROM sessions WHERE id = ?1",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let session = stmt
        .query_row(params![session_id], |row| {
            Ok(FullSessionRow {
                id: row.get(0)?,
                title: row.get(1)?,
                session_type: row.get(2)?,
                model: row.get(3)?,
                workspace_path: row.get(4)?,
                anonymous: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                sync_status: row.get(8)?,
                messages: Vec::new(),
            })
        })
        .optional()
        .map_err(|e| format!("Query error: {}", e))?;

    let Some(mut session) = session else {
        return Ok(None);
    };

    let mut msg_stmt = conn
        .prepare(
            "SELECT seq, role, content, blocks_json, files_json, created_at
             FROM messages WHERE session_id = ?1 ORDER BY seq ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let messages = msg_stmt
        .query_map(params![session_id], |row| {
            Ok(MessageRow {
                seq: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                blocks_json: row.get(3)?,
                files_json: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("Query error: {}", e))?;

    for msg in messages {
        session
            .messages
            .push(msg.map_err(|e| format!("Row error: {}", e))?);
    }

    Ok(Some(session))
}

#[tauri::command]
pub fn db_create_session(
    id: String,
    title: String,
    session_type: String,
    model: String,
    workspace_path: String,
    anonymous: bool,
    created_at: i64,
    updated_at: i64,
) -> Result<(), String> {
    let conn = get_db()?;
    conn.execute(
        "INSERT INTO sessions (id, title, type, model, workspace_path, anonymous, created_at, updated_at, sync_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'dirty')",
        params![
            id,
            title,
            session_type,
            model,
            workspace_path,
            anonymous as i64,
            created_at,
            updated_at,
        ],
    )
    .map_err(|e| format!("Insert error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_append_message(
    session_id: String,
    role: String,
    content: String,
    blocks_json: Option<String>,
    files_json: Option<String>,
) -> Result<i64, String> {
    let conn = get_db()?;
    let now = now_ms();

    let seq: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Query error: {}", e))?;

    conn.execute(
        "INSERT INTO messages (session_id, seq, role, content, blocks_json, files_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![session_id, seq, role, content, blocks_json, files_json, now],
    )
    .map_err(|e| format!("Insert error: {}", e))?;

    conn.execute(
        "UPDATE sessions SET updated_at = ?1, sync_status = 'dirty' WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|e| format!("Update error: {}", e))?;

    Ok(seq)
}

#[derive(serde::Deserialize)]
struct MessageData {
    role: String,
    content: serde_json::Value,
    blocks: Option<serde_json::Value>,
    files: Option<serde_json::Value>,
}

#[tauri::command]
pub fn db_set_messages(session_id: String, messages_json: String) -> Result<(), String> {
    let messages: Vec<MessageData> =
        serde_json::from_str(&messages_json).map_err(|e| format!("JSON parse error: {}", e))?;

    let conn = get_db()?;
    let now = now_ms();

    conn.execute(
        "DELETE FROM messages WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| format!("Delete error: {}", e))?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO messages (session_id, seq, role, content, blocks_json, files_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(|e| format!("Prepare error: {}", e))?;

    for (i, msg) in messages.iter().enumerate() {
        let content_str = match &msg.content {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        let blocks_str = msg.blocks.as_ref().map(|v| v.to_string());
        let files_str = msg.files.as_ref().map(|v| v.to_string());

        stmt.execute(params![
            session_id,
            (i + 1) as i64,
            msg.role,
            content_str,
            blocks_str,
            files_str,
            now,
        ])
        .map_err(|e| format!("Insert error: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn db_update_session_meta(
    session_id: String,
    title: Option<String>,
    model: Option<String>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    let conn = get_db()?;
    let now = now_ms();

    let mut sets = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref t) = title {
        sets.push("title = ?");
        values.push(Box::new(t.clone()));
    }
    if let Some(ref m) = model {
        sets.push("model = ?");
        values.push(Box::new(m.clone()));
    }
    if let Some(ref w) = workspace_path {
        sets.push("workspace_path = ?");
        values.push(Box::new(w.clone()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    sets.push("updated_at = ?");
    values.push(Box::new(now));
    sets.push("sync_status = 'dirty'");

    let sql = format!("UPDATE sessions SET {} WHERE id = ?", sets.join(", "));
    values.push(Box::new(session_id));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| format!("Update error: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn db_delete_session(session_id: String) -> Result<(), String> {
    let conn = get_db()?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
        .map_err(|e| format!("Delete error: {}", e))?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct DirtySessionExport {
    id: String,
    title: String,
    #[serde(rename = "type")]
    session_type: String,
    model: String,
    workspace_path: String,
    messages_json: String,
}

#[tauri::command]
pub fn db_get_dirty_sessions() -> Result<Vec<DirtySessionExport>, String> {
    let conn = get_db()?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, type, model, workspace_path
             FROM sessions WHERE sync_status = 'dirty'",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let sessions: Vec<(String, String, String, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| format!("Query error: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Row error: {}", e))?;

    let mut msg_stmt = conn
        .prepare(
            "SELECT role, content, blocks_json, files_json
             FROM messages WHERE session_id = ?1 ORDER BY seq ASC",
        )
        .map_err(|e| format!("Query prepare error: {}", e))?;

    let mut result = Vec::new();
    for (id, title, session_type, model, workspace_path) in sessions {
        let messages: Vec<serde_json::Value> = msg_stmt
            .query_map(params![id], |row| {
                let role: String = row.get(0)?;
                let content: String = row.get(1)?;
                let blocks_json: Option<String> = row.get(2)?;
                let files_json: Option<String> = row.get(3)?;
                Ok((role, content, blocks_json, files_json))
            })
            .map_err(|e| format!("Query error: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Row error: {}", e))?
            .into_iter()
            .map(|(role, content, blocks_json, files_json)| {
                let mut obj = serde_json::json!({
                    "role": role,
                    "content": content,
                });
                if let Some(b) = blocks_json {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&b) {
                        obj["blocks"] = v;
                    }
                }
                if let Some(f) = files_json {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&f) {
                        obj["files"] = v;
                    }
                }
                obj
            })
            .collect();

        result.push(DirtySessionExport {
            id,
            title,
            session_type,
            model,
            workspace_path,
            messages_json: serde_json::to_string(&messages)
                .map_err(|e| format!("JSON serialize error: {}", e))?,
        });
    }

    Ok(result)
}

#[tauri::command]
pub fn db_mark_synced(session_id: String) -> Result<(), String> {
    let conn = get_db()?;
    conn.execute(
        "UPDATE sessions SET sync_status = 'synced' WHERE id = ?1 AND sync_status = 'dirty'",
        params![session_id],
    )
    .map_err(|e| format!("Update error: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn db_mark_syncing(session_id: String) -> Result<(), String> {
    let conn = get_db()?;
    conn.execute(
        "UPDATE sessions SET sync_status = 'syncing' WHERE id = ?1 AND sync_status = 'dirty'",
        params![session_id],
    )
    .map_err(|e| format!("Update error: {}", e))?;
    Ok(())
}
