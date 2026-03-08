use askama::Template;
use axum::extract::State;
use axum::response::IntoResponse;

use crate::auth::AuthUser;
use crate::error::{render_template, AppError};
use crate::AppState;

#[derive(Template)]
#[template(path = "chat.html")]
struct ChatTemplate {
    gateway_url: String,
    user_name: String,
    auth_token: String,
}

/// Chat page — requires any authenticated user.
/// Cookie token doubles as the Gateway auth token (shared DB).
pub async fn page(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<impl IntoResponse, AppError> {
    let gateway_url = state
        .config
        .gateway
        .public_url
        .as_deref()
        .unwrap_or(&state.config.gateway.url)
        .to_string();

    render_template(&ChatTemplate {
        gateway_url,
        user_name: auth.user.name.clone(),
        auth_token: auth.token,
    })
}
