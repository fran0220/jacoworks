use askama::Template;
use axum::extract::State;
use axum::response::IntoResponse;

use crate::error::{render_template, AppError};
use crate::models::release;
use crate::AppState;

#[derive(Template)]
#[template(path = "pages/index.html")]
struct IndexTemplate {}

pub async fn index() -> Result<impl IntoResponse, AppError> {
    render_template(&IndexTemplate {})
}

pub struct AssetView {
    pub platform: String,
    pub download_url: String,
    pub file_size: String,
}

#[derive(Template)]
#[template(path = "pages/download.html")]
struct DownloadTemplate {
    latest_version: String,
    latest_date: String,
    assets: Vec<AssetView>,
}

pub async fn download(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let latest = release::get_latest_release(&state.db).await?;

    let (version, date, assets) = if let Some(ref rel) = latest {
        let raw_assets = release::list_assets(&state.db, &rel.id).await?;
        let views: Vec<AssetView> = raw_assets
            .iter()
            .map(|a| AssetView {
                platform: a.platform.clone(),
                download_url: a.download_url.clone(),
                file_size: format_file_size(a.file_size),
            })
            .collect();
        (
            rel.version.clone(),
            rel.pub_date.format("%Y-%m-%d").to_string(),
            views,
        )
    } else {
        (String::new(), String::new(), vec![])
    };

    render_template(&DownloadTemplate {
        latest_version: version,
        latest_date: date,
        assets,
    })
}

#[derive(Template)]
#[template(path = "pages/about.html")]
struct AboutTemplate {}

pub async fn about() -> Result<impl IntoResponse, AppError> {
    render_template(&AboutTemplate {})
}

fn format_file_size(bytes: i64) -> String {
    if bytes <= 0 {
        return String::new();
    }
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{:.1} MB", mb)
    }
}
