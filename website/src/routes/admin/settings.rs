use std::collections::HashMap;

use askama::Template;
use axum::extract::State;
use axum::response::IntoResponse;

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::services::gateway::GatewayClient;
use crate::AppState;

struct SettingView {
    key: String,
    value: String,
    masked_value: String,
    description: String,
    is_secret: bool,
}

struct ModelView {
    id: String,
    provider: String,
    label: String,
}

#[derive(Template)]
#[template(path = "admin/settings.html")]
struct SettingsTemplate {
    admin_name: String,
    active_page: String,
    gateway_status: String,
    db_status: String,
    app_version: String,
    models: Vec<ModelView>,
    settings: Vec<SettingView>,
    save_success: bool,
    save_error: Option<String>,
}

fn mask_value(value: &str) -> String {
    if value.is_empty() {
        return "未配置".to_string();
    }
    if value.len() <= 8 {
        return "*".repeat(value.len());
    }
    let visible = &value[..4];
    format!("{}{}", visible, "*".repeat(value.len() - 4))
}

fn is_secret_key(key: &str) -> bool {
    matches!(
        key,
        "llm_proxy_key" | "openai_api_key" | "exa_api_key" | "tavily_api_key"
        | "embedding_api_key" | "fal_api_key" | "jimeng_api_key"
        | "feishu_client_secret" | "admin_token" | "github_token"
    )
}

pub async fn index(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    render_settings_page(&state, &admin, false, None).await
}

#[derive(serde::Deserialize)]
pub struct UpdateSettingsForm {
    llm_proxy_url: Option<String>,
    llm_proxy_key: Option<String>,
    openai_api_key: Option<String>,
    exa_api_key: Option<String>,
    tavily_api_key: Option<String>,
    embedding_base_url: Option<String>,
    embedding_api_key: Option<String>,
    fal_api_key: Option<String>,
    jimeng_api_url: Option<String>,
    jimeng_api_key: Option<String>,
    feishu_client_id: Option<String>,
    feishu_client_secret: Option<String>,
    admin_token: Option<String>,
    github_token: Option<String>,
    github_repo: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    admin: AdminUser,
    axum::Form(form): axum::Form<UpdateSettingsForm>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    let mut settings = HashMap::new();

    // Only include non-empty values (empty means "don't change")
    // For secret fields, a value of all asterisks means "don't change"
    if let Some(v) = form.llm_proxy_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("llm_proxy_url".to_string(), v);
        }
    }
    if let Some(v) = form.feishu_client_id {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("feishu_client_id".to_string(), v);
        }
    }
    if let Some(v) = form.embedding_base_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("embedding_base_url".to_string(), v);
        }
    }
    if let Some(v) = form.jimeng_api_url {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("jimeng_api_url".to_string(), v);
        }
    }
    if let Some(v) = form.github_repo {
        let v = v.trim().to_string();
        if !v.is_empty() {
            settings.insert("github_repo".to_string(), v);
        }
    }
    for (key, value) in [
        ("llm_proxy_key", form.llm_proxy_key),
        ("openai_api_key", form.openai_api_key),
        ("exa_api_key", form.exa_api_key),
        ("tavily_api_key", form.tavily_api_key),
        ("embedding_api_key", form.embedding_api_key),
        ("fal_api_key", form.fal_api_key),
        ("jimeng_api_key", form.jimeng_api_key),
        ("feishu_client_secret", form.feishu_client_secret),
        ("admin_token", form.admin_token),
        ("github_token", form.github_token),
    ] {
        if let Some(v) = value {
            let v = v.trim().to_string();
            if !v.is_empty() && !v.chars().all(|c| c == '*') {
                settings.insert(key.to_string(), v);
            }
        }
    }

    if settings.is_empty() {
        return render_settings_page(&state, &admin, false, Some("没有需要更新的配置".into()))
            .await;
    }

    match client.update_settings(settings).await {
        Ok(_) => render_settings_page(&state, &admin, true, None).await,
        Err(e) => render_settings_page(&state, &admin, false, Some(format!("保存失败: {e}"))).await,
    }
}

async fn render_settings_page(
    state: &AppState,
    admin: &AdminUser,
    save_success: bool,
    save_error: Option<String>,
) -> Result<impl IntoResponse, AppError> {
    let client = GatewayClient::new(
        state.http_client.clone(),
        state.config.gateway.url.clone(),
        state.config.gateway.admin_token.clone(),
    );

    let gateway_status = match client.health().await {
        Ok(true) => "healthy".to_string(),
        _ => "unhealthy".to_string(),
    };

    let db_status = match sqlx::query("SELECT 1").execute(&state.db).await {
        Ok(_) => "连接正常".to_string(),
        Err(_) => "连接异常".to_string(),
    };

    let (raw_settings, gateway_fetch_error) = match client.get_settings().await {
        Ok(settings) => (settings, None),
        Err(err) => (
            Vec::new(),
            Some(format!("网关设置读取失败: {err}")),
        ),
    };
    let settings: Vec<SettingView> = raw_settings
        .into_iter()
        .map(|s| {
            let is_secret = is_secret_key(&s.key);
            SettingView {
                masked_value: if is_secret {
                    mask_value(&s.value)
                } else {
                    s.value.clone()
                },
                key: s.key,
                value: if is_secret { String::new() } else { s.value },
                description: s.description,
                is_secret,
            }
        })
        .collect();

    let models = vec![
        ModelView {
            id: "claude-sonnet-4-6".into(),
            provider: "Claude".into(),
            label: "Sonnet 4.6".into(),
        },
        ModelView {
            id: "claude-opus-4-6".into(),
            provider: "Claude".into(),
            label: "Opus 4.6".into(),
        },
        ModelView {
            id: "claude-haiku-4-5-20251001".into(),
            provider: "Claude".into(),
            label: "Haiku 4.5".into(),
        },
        ModelView {
            id: "gpt-5.3-codex".into(),
            provider: "GPT".into(),
            label: "GPT-5.3 Codex".into(),
        },
        ModelView {
            id: "gpt-5.2".into(),
            provider: "GPT".into(),
            label: "GPT-5.2".into(),
        },
        ModelView {
            id: "gemini-3.1-pro-preview".into(),
            provider: "Gemini".into(),
            label: "Gemini 3.1 Pro".into(),
        },
        ModelView {
            id: "gemini-3-flash-preview".into(),
            provider: "Gemini".into(),
            label: "Gemini 3 Flash".into(),
        },
        ModelView {
            id: "grok-4.20-beta".into(),
            provider: "Grok".into(),
            label: "Grok 4.20".into(),
        },
        ModelView {
            id: "grok-4.1-fast".into(),
            provider: "Grok".into(),
            label: "Grok 4.1 Fast".into(),
        },
    ];

    render_template(&SettingsTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "settings".into(),
        gateway_status,
        db_status,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        models,
        settings,
        save_success,
        save_error: save_error.or(gateway_fetch_error),
    })
}
