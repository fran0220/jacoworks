use askama::Template;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Redirect};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::invite;
use crate::AppState;

struct InviteCodeView {
    code: String,
    role: String,
    max_uses: i32,
    used_count: i32,
    note: String,
    expires_at: String,
    created_at: String,
    is_expired: bool,
    is_exhausted: bool,
}

#[derive(Template)]
#[template(path = "admin/invites.html")]
struct InvitesTemplate {
    admin_name: String,
    active_page: String,
    codes: Vec<InviteCodeView>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let raw_codes = invite::list_invite_codes(&state.db).await?;
    let now = chrono::Utc::now();
    let codes: Vec<InviteCodeView> = raw_codes
        .into_iter()
        .map(|c| {
            let is_expired = c.expires_at.map(|e| e < now).unwrap_or(false);
            let is_exhausted = c.used_count >= c.max_uses;
            InviteCodeView {
                code: c.code,
                role: c.role,
                max_uses: c.max_uses,
                used_count: c.used_count,
                note: c.note,
                expires_at: c
                    .expires_at
                    .map(|e| e.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_default(),
                created_at: c.created_at.format("%Y-%m-%d %H:%M").to_string(),
                is_expired,
                is_exhausted,
            }
        })
        .collect();

    render_template(&InvitesTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "invites".into(),
        codes,
    })
}

#[derive(serde::Deserialize)]
pub struct CreateInviteForm {
    role: String,
    max_uses: i32,
    note: Option<String>,
    expires_at: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    admin: AdminUser,
    axum::Form(form): axum::Form<CreateInviteForm>,
) -> Result<impl IntoResponse, AppError> {
    let code = generate_code();
    let role = if form.role == "admin" {
        "admin"
    } else {
        "user"
    };
    let max_uses = form.max_uses.max(1);
    let note = form.note.unwrap_or_default();

    let expires = form
        .expires_at
        .filter(|s| !s.is_empty())
        .and_then(|s| chrono::NaiveDateTime::parse_from_str(&s, "%Y-%m-%dT%H:%M").ok())
        .map(|dt| dt.and_utc());

    invite::create_invite_code(
        &state.db,
        &code,
        role,
        max_uses,
        &note,
        expires,
        Some(&admin.0.id),
    )
    .await?;

    Ok(Redirect::to("/admin/invites"))
}

pub async fn revoke(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(code): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    invite::revoke_invite_code(&state.db, &code).await?;
    Ok(Redirect::to("/admin/invites"))
}

fn generate_code() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let chars: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".chars().collect();
    (0..8)
        .map(|i| {
            let idx = ((seed >> (i * 5)) as usize) % chars.len();
            chars[idx]
        })
        .collect()
}
