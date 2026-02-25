use askama::Template;
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Redirect};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::feedback as fb_model;
use crate::AppState;

struct FeedbackView {
    id: String,
    name: String,
    email: String,
    category: String,
    message: String,
    app_version: String,
    status: String,
    admin_reply: String,
    created_at: String,
}

#[derive(Template)]
#[template(path = "admin/feedback_list.html")]
struct FeedbackListTemplate {
    admin_name: String,
    active_page: String,
    current_filter: String,
    items: Vec<FeedbackView>,
}

#[derive(serde::Deserialize)]
pub struct FilterParams {
    status: Option<String>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
    Query(params): Query<FilterParams>,
) -> Result<impl IntoResponse, AppError> {
    let filter = params.status.as_deref();
    let current_filter = filter.unwrap_or("all").to_string();
    let raw = fb_model::list_feedback(&state.db, filter).await?;

    let items: Vec<FeedbackView> = raw
        .into_iter()
        .map(|f| FeedbackView {
            id: f.id,
            name: f.name.unwrap_or_default(),
            email: f.email.unwrap_or_default(),
            category: f.category,
            message: f.message,
            app_version: f.app_version.unwrap_or_default(),
            status: f.status,
            admin_reply: f.admin_reply.unwrap_or_default(),
            created_at: f.created_at.format("%Y-%m-%d %H:%M").to_string(),
        })
        .collect();

    render_template(&FeedbackListTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "feedback".into(),
        current_filter,
        items,
    })
}

#[derive(serde::Deserialize)]
pub struct ReplyForm {
    reply: String,
    status: Option<String>,
}

pub async fn reply(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<ReplyForm>,
) -> Result<impl IntoResponse, AppError> {
    if !form.reply.trim().is_empty() {
        fb_model::reply_feedback(&state.db, &id, form.reply.trim()).await?;
    }
    if let Some(status) = &form.status {
        fb_model::update_feedback_status(&state.db, &id, status).await?;
    }
    Ok(Redirect::to("/admin/feedback"))
}

#[derive(serde::Deserialize)]
pub struct StatusForm {
    status: String,
}

pub async fn update_status(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<StatusForm>,
) -> Result<impl IntoResponse, AppError> {
    fb_model::update_feedback_status(&state.db, &id, &form.status).await?;
    Ok(Redirect::to("/admin/feedback"))
}
