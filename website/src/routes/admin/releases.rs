use askama::Template;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Redirect};

use crate::auth::AdminUser;
use crate::error::{render_template, AppError};
use crate::models::release;
use crate::AppState;

struct AssetView {
    id: String,
    platform: String,
    platform_label: String,
    download_url: String,
    file_size: String,
    download_count: i32,
}

struct ReleaseView {
    id: String,
    version: String,
    notes: String,
    notes_preview: String,
    pub_date: String,
    created_at: String,
    is_latest: bool,
    assets: Vec<AssetView>,
}

#[derive(Template)]
#[template(path = "admin/releases.html")]
struct ReleasesTemplate {
    admin_name: String,
    active_page: String,
    releases: Vec<ReleaseView>,
}

struct ReleaseEditView {
    id: String,
    version: String,
    notes: String,
}

#[derive(Template)]
#[template(path = "admin/release_edit.html")]
struct ReleaseEditTemplate {
    admin_name: String,
    active_page: String,
    release: ReleaseEditView,
    assets: Vec<AssetView>,
}

pub async fn list(
    State(state): State<AppState>,
    admin: AdminUser,
) -> Result<impl IntoResponse, AppError> {
    let raw_releases = release::list_releases(&state.db).await?;
    let mut releases = Vec::new();

    for r in raw_releases {
        let raw_assets = release::list_assets(&state.db, &r.id).await?;
        let assets: Vec<AssetView> = raw_assets.iter().map(|a| asset_view(a)).collect();
        let notes = r.notes.clone().unwrap_or_default();
        let notes_preview = if notes.len() > 100 {
            format!("{}…", &notes[..100])
        } else {
            notes.clone()
        };
        releases.push(ReleaseView {
            id: r.id,
            version: r.version,
            notes,
            notes_preview,
            pub_date: r.pub_date.format("%Y-%m-%d").to_string(),
            created_at: r.created_at.format("%Y-%m-%d %H:%M").to_string(),
            is_latest: r.is_latest,
            assets,
        });
    }

    render_template(&ReleasesTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "releases".into(),
        releases,
    })
}

#[derive(serde::Deserialize)]
pub struct CreateReleaseForm {
    version: String,
    notes: Option<String>,
}

pub async fn create(
    State(state): State<AppState>,
    _admin: AdminUser,
    axum::Form(form): axum::Form<CreateReleaseForm>,
) -> Result<impl IntoResponse, AppError> {
    release::create_release(&state.db, &form.version, form.notes.as_deref()).await?;
    Ok(Redirect::to("/admin/releases"))
}

pub async fn edit_form(
    State(state): State<AppState>,
    admin: AdminUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let r = release::get_release(&state.db, &id)
        .await?
        .ok_or(AppError::NotFound("Release not found".into()))?;
    let raw_assets = release::list_assets(&state.db, &r.id).await?;
    let assets: Vec<AssetView> = raw_assets.iter().map(|a| asset_view(a)).collect();

    render_template(&ReleaseEditTemplate {
        admin_name: admin.0.name.clone(),
        active_page: "releases".into(),
        release: ReleaseEditView {
            id: r.id,
            version: r.version,
            notes: r.notes.unwrap_or_default(),
        },
        assets,
    })
}

#[derive(serde::Deserialize)]
pub struct UpdateReleaseForm {
    version: String,
    notes: Option<String>,
}

pub async fn update(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<UpdateReleaseForm>,
) -> Result<impl IntoResponse, AppError> {
    release::update_release(&state.db, &id, &form.version, form.notes.as_deref()).await?;
    Ok(Redirect::to(&format!("/admin/releases/{}/edit", id)))
}

pub async fn upload(_admin: AdminUser, Path(id): Path<String>) -> impl IntoResponse {
    Redirect::to(&format!("/admin/releases/{id}/edit"))
}

#[derive(serde::Deserialize)]
pub struct UploadAssetForm {
    platform: String,
    download_url: String,
    signature: Option<String>,
    file_size: Option<String>,
}

pub async fn upload_asset(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    axum::Form(form): axum::Form<UploadAssetForm>,
) -> Result<impl IntoResponse, AppError> {
    release::create_asset(
        &state.db,
        &id,
        &form.platform,
        &form.download_url,
        form.signature.as_deref().unwrap_or(""),
        parse_file_size(form.file_size.as_deref()),
    )
    .await?;
    Ok(Redirect::to(&format!("/admin/releases/{}/edit", id)))
}

pub async fn delete_asset(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path((release_id, asset_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, AppError> {
    release::delete_asset(&state.db, &asset_id).await?;
    Ok(Redirect::to(&format!("/admin/releases/{release_id}/edit")))
}

pub async fn set_latest(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    release::set_latest(&state.db, &id).await?;
    Ok(Redirect::to("/admin/releases"))
}

pub async fn delete(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    release::delete_release(&state.db, &id).await?;
    Ok(Redirect::to("/admin/releases"))
}

fn asset_view(a: &release::ReleaseAsset) -> AssetView {
    AssetView {
        id: a.id.clone(),
        platform: a.platform.clone(),
        platform_label: platform_label(&a.platform).to_string(),
        download_url: a.download_url.clone(),
        file_size: format_file_size(a.file_size),
        download_count: a.download_count,
    }
}

fn platform_label(p: &str) -> &'static str {
    match p {
        "darwin-aarch64" => "macOS (Apple Silicon)",
        "darwin-x86_64" => "macOS (Intel)",
        "windows-x86_64" => "Windows (64-bit)",
        "linux-x86_64" => "Linux (x86_64)",
        _ => "Other",
    }
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

fn parse_file_size(input: Option<&str>) -> i64 {
    let Some(raw) = input else {
        return 0;
    };

    let normalized = raw.trim().to_lowercase();
    if normalized.is_empty() {
        return 0;
    }

    if let Ok(bytes) = normalized.parse::<i64>() {
        return bytes.max(0);
    }

    let compact = normalized.replace([',', ' '], "");
    let split_at = compact
        .chars()
        .position(|c| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(compact.len());
    let (number_part, unit_part) = compact.split_at(split_at);

    let Ok(value) = number_part.parse::<f64>() else {
        return 0;
    };

    let multiplier = match unit_part {
        "" | "b" => 1.0,
        "k" | "kb" => 1024.0,
        "m" | "mb" => 1024.0 * 1024.0,
        "g" | "gb" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };

    (value * multiplier).round() as i64
}
