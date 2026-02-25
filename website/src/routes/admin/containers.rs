use askama::Template;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Redirect};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::session;
use crate::services::gateway::GatewayClient;
use crate::AppState;

struct ContainerView {
    id: String,
    name: String,
    user_name: String,
    ip: String,
    status: String,
}

#[derive(Template)]
#[template(path = "admin/containers.html")]
struct ContainersTemplate {
    admin_name: String,
    active_page: String,
    containers: Vec<ContainerView>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let db_containers = session::list_containers(&state.db).await?;
    let containers: Vec<ContainerView> = db_containers
        .into_iter()
        .map(|c| ContainerView {
            id: c.container_name.clone(),
            name: c.container_name,
            user_name: c.user_id,
            ip: c.container_ip.unwrap_or_default(),
            status: c.status,
        })
        .collect();

    render_template(&ContainersTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "containers".into(),
        containers,
    })
}

pub async fn start(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );
    let _ = client.start_container(&id).await;
    Ok(Redirect::to("/admin/containers"))
}

pub async fn stop(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );
    let _ = client.stop_container(&id).await;
    Ok(Redirect::to("/admin/containers"))
}
