use askama::Template;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use tower_cookies::CookieManagerLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod db;
mod error;
mod models;
mod routes;
mod services;

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: config::Config,
    pub http_client: reqwest::Client,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // Config
    let config_path =
        std::env::var("WEBSITE_CONFIG_PATH").unwrap_or_else(|_| "website.toml".to_string());
    let config = config::Config::load(&config_path)?;
    tracing::info!("Loaded config from {config_path}");

    // Database
    let db = db::create_pool(&config.database.url).await?;
    tracing::info!("Connected to database");

    // State
    let state = AppState {
        db,
        config: config.clone(),
        http_client: reqwest::Client::new(),
    };

    // Routes
    let app = Router::new()
        // Public pages
        .route("/", get(routes::pages::index))
        .route("/download", get(routes::pages::download))
        .route("/about", get(routes::pages::about))
        .route("/docs", get(routes::docs::index))
        .route("/docs/{*path}", get(routes::docs::page))
        .route(
            "/feedback",
            get(routes::feedback::form_page).post(routes::feedback::submit),
        )
        // Update API (Tauri updater)
        .route(
            "/api/update/{target}/{arch}/{current_version}",
            get(routes::update::check),
        )
        // Admin auth (no AdminUser extractor — these are the login/logout endpoints)
        .route(
            "/admin/login",
            get(admin_login_page).post(admin_login_action),
        )
        .route("/admin/logout", post(admin_logout_action))
        .route("/admin/feishu/callback", get(admin_feishu_callback))
        // Admin sub-router (all routes require AdminUser)
        .nest("/admin", routes::admin::admin_routes())
        // Static files
        .nest_service("/static", ServeDir::new("static"))
        // Release downloads (populated by CI → SCP → /opt/jacoworks/releases/)
        .nest_service("/releases", ServeDir::new(&config.server.releases_dir))
        // Layers
        .layer(CookieManagerLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Bind
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on {addr}");

    // Graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

// --- Admin login/logout handlers (outside the admin sub-router) ---

#[derive(Template)]
#[template(path = "admin/login.html")]
#[allow(dead_code)]
struct AdminLoginTemplate {
    error: Option<String>,
    feishu_url: Option<String>,
}

async fn admin_login_page(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<impl axum::response::IntoResponse, error::AppError> {
    error::render_template(&AdminLoginTemplate {
        error: None,
        feishu_url: build_feishu_url(&state.config),
    })
}

async fn admin_login_action(
    axum::extract::State(state): axum::extract::State<AppState>,
    cookies: tower_cookies::Cookies,
    axum::extract::Form(form): axum::extract::Form<LoginForm>,
) -> Result<axum::response::Response, error::AppError> {
    let user = match auth::admin_login(&state.db, &form.email, &form.password).await {
        Ok(user) => user,
        Err(error::AppError::Unauthorized) => {
            let html = error::render_template(&AdminLoginTemplate {
                error: Some("邮箱或密码错误".to_string()),
                feishu_url: build_feishu_url(&state.config),
            })?;
            return Ok(html.into_response());
        }
        Err(e) => return Err(e),
    };

    let token = auth::generate_token();
    let expires = chrono::Utc::now() + chrono::Duration::days(30);
    models::auth_session::create_auth_session(&state.db, &user.id, &token, expires, None, None)
        .await?;

    auth::set_session_cookie(&cookies, &token);
    Ok(axum::response::Redirect::to("/admin").into_response())
}

async fn admin_logout_action(cookies: tower_cookies::Cookies) -> impl axum::response::IntoResponse {
    if let Some(cookie) = cookies.get("admin_session") {
        let _ = cookie.value();
    }
    auth::remove_session_cookie(&cookies);
    axum::response::Redirect::to("/admin/login")
}

#[derive(serde::Deserialize)]
struct LoginForm {
    email: String,
    password: String,
}

/// Build the Feishu SSO URL that redirects to the Gateway's OAuth endpoint.
fn build_feishu_url(config: &config::Config) -> Option<String> {
    let gw_public = config
        .gateway
        .public_url
        .as_deref()
        .unwrap_or(&config.gateway.url);
    let callback = format!("{}/admin/feishu/callback", config.site.base_url);
    let encoded = urlencoding::encode(&callback);
    Some(format!("{gw_public}/api/auth/feishu?redirect={encoded}"))
}

/// Handle the Feishu OAuth callback from Gateway.
/// The Gateway creates an auth_session in the shared DB and redirects here with ?token=xxx.
#[derive(serde::Deserialize)]
struct FeishuCallbackParams {
    token: Option<String>,
    error: Option<String>,
}

async fn admin_feishu_callback(
    axum::extract::State(state): axum::extract::State<AppState>,
    cookies: tower_cookies::Cookies,
    axum::extract::Query(params): axum::extract::Query<FeishuCallbackParams>,
) -> Result<axum::response::Response, error::AppError> {
    if let Some(err) = &params.error {
        tracing::warn!("Feishu SSO error: {err}");
        let html = error::render_template(&AdminLoginTemplate {
            error: Some(format!("飞书登录失败: {err}")),
            feishu_url: build_feishu_url(&state.config),
        })?;
        return Ok(html.into_response());
    }

    let token = params.token.as_deref().unwrap_or("");
    if token.is_empty() {
        let html = error::render_template(&AdminLoginTemplate {
            error: Some("飞书登录失败: 未收到令牌".to_string()),
            feishu_url: build_feishu_url(&state.config),
        })?;
        return Ok(html.into_response());
    }

    // Look up the auth_session created by Gateway in the shared DB
    let session = models::auth_session::get_session_by_token(&state.db, token).await?;
    let (user_id, role) = match session {
        Some(s) => s,
        None => {
            let html = error::render_template(&AdminLoginTemplate {
                error: Some("飞书登录失败: 会话无效".to_string()),
                feishu_url: build_feishu_url(&state.config),
            })?;
            return Ok(html.into_response());
        }
    };

    if role != "admin" {
        let html = error::render_template(&AdminLoginTemplate {
            error: Some("该飞书账号没有管理员权限".to_string()),
            feishu_url: build_feishu_url(&state.config),
        })?;
        return Ok(html.into_response());
    }

    tracing::info!(user_id, "admin logged in via Feishu SSO");
    auth::set_session_cookie(&cookies, token);
    Ok(axum::response::Redirect::to("/admin").into_response())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received");
}
