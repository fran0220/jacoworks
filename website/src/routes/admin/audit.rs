use askama::Template;
use axum::extract::{Query, State};
use axum::response::IntoResponse;

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::audit;
use crate::AppState;

struct AuditLogView {
    id: i64,
    user_id: String,
    action: String,
    resource_type: String,
    resource_id: String,
    ip: String,
    detail: String,
    created_at: String,
}

#[derive(Template)]
#[template(path = "admin/audit.html")]
struct AuditTemplate {
    admin_name: String,
    active_page: String,
    logs: Vec<AuditLogView>,
    total: i64,
    page: i64,
}

#[derive(serde::Deserialize)]
pub struct AuditParams {
    page: Option<i64>,
    user_id: Option<String>,
    action: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(params): Query<AuditParams>,
) -> Result<impl IntoResponse, AppError> {
    let page = params.page.unwrap_or(1).max(1);
    let limit = 50i64;
    let offset = (page - 1) * limit;

    let user_id = params.user_id.as_deref().filter(|s| !s.is_empty());
    let action = params.action.as_deref().filter(|s| !s.is_empty());

    let total = audit::count_audit_logs(&state.db, user_id, action).await?;
    let raw_logs = audit::list_audit_logs(&state.db, user_id, action, limit, offset).await?;

    let logs: Vec<AuditLogView> = raw_logs
        .into_iter()
        .map(|l| AuditLogView {
            id: l.id,
            user_id: l.user_id.unwrap_or_default(),
            action: l.action,
            resource_type: l.resource_type.unwrap_or_default(),
            resource_id: l.resource_id.unwrap_or_default(),
            ip: l.ip_address.unwrap_or_default(),
            detail: serde_json::to_string_pretty(&l.detail).unwrap_or_default(),
            created_at: l.created_at.format("%Y-%m-%d %H:%M:%S").to_string(),
        })
        .collect();

    render_template(&AuditTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "audit".into(),
        logs,
        total,
        page,
    })
}
