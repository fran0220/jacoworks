use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;

use crate::error::AppError;
use crate::models::release;
use crate::AppState;

#[derive(Serialize)]
struct UpdateResponse {
    version: String,
    notes: Option<String>,
    pub_date: String,
    url: String,
    signature: String,
}

/// Tauri updater endpoint: GET /api/update/:target/:arch/:current_version
/// Returns 204 if up-to-date, or JSON with update info.
pub async fn check(
    State(state): State<AppState>,
    Path((target, arch, current_version)): Path<(String, String, String)>,
) -> Result<impl IntoResponse, AppError> {
    let latest = release::get_latest_release(&state.db).await?;

    let latest = match latest {
        Some(r) => r,
        None => return Ok(axum::http::StatusCode::NO_CONTENT.into_response()),
    };

    // If client is already on the latest version, return 204
    if latest.version == current_version {
        return Ok(axum::http::StatusCode::NO_CONTENT.into_response());
    }

    // Map target/arch to platform string (e.g. "darwin-aarch64")
    let platform = format!("{target}-{arch}");
    let asset = release::get_asset_for_platform(&state.db, &latest.id, &platform).await?;

    let asset = match asset {
        Some(a) => a,
        None => {
            return Err(AppError::NotFound(format!(
                "No asset for platform {platform}"
            )))
        }
    };

    // Increment download counter
    let _ = release::increment_download_count(&state.db, &asset.id).await;

    Ok(Json(UpdateResponse {
        version: latest.version,
        notes: latest.notes,
        pub_date: latest.pub_date.to_rfc3339(),
        url: asset.download_url,
        signature: asset.signature,
    })
    .into_response())
}
