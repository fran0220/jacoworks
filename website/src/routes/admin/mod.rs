pub mod audit;
pub mod containers;
pub mod dashboard;
pub mod feedback;
pub mod invites;
pub mod logs;
pub mod releases;
pub mod settings;
pub mod skills;
pub mod users;

use axum::routing::{delete, get, post, put};
use axum::Router;

use crate::AppState;

/// Build admin sub-router. All routes require AdminUser extractor.
pub fn admin_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(dashboard::index))
        .route("/users", get(users::list))
        .route("/users/{id}", get(users::detail))
        .route("/users/{id}/role", post(users::change_role))
        .route("/users/{id}/toggle", post(users::toggle_role))
        .route("/users/{id}/toggle-role", post(users::toggle_role))
        .route("/invites", get(invites::list).post(invites::create))
        .route("/invites/{code}", delete(invites::revoke))
        .route("/invites/{code}/revoke", post(invites::revoke))
        .route("/releases", get(releases::list).post(releases::create))
        .route("/releases/{id}/edit", get(releases::edit_form))
        .route(
            "/releases/{id}",
            put(releases::update)
                .post(releases::update)
                .delete(releases::delete),
        )
        .route("/releases/{id}/assets", post(releases::upload_asset))
        .route(
            "/releases/{id}/assets/{asset_id}",
            delete(releases::delete_asset),
        )
        .route("/releases/{id}/set-latest", post(releases::set_latest))
        .route("/releases/{id}/latest", post(releases::set_latest))
        .route("/releases/{id}/delete", post(releases::delete))
        .route("/containers", get(containers::list))
        .route("/containers/{id}/start", post(containers::start))
        .route("/containers/{id}/stop", post(containers::stop))
        .route("/feedback", get(feedback::list))
        .route("/feedback/{id}/reply", post(feedback::reply))
        .route("/feedback/{id}/status", post(feedback::update_status))
        .route("/audit", get(audit::list))
        .route("/logs", get(logs::index))
        .route("/settings", get(settings::index).post(settings::update))
        .route("/skills", get(skills::list))
        .route("/skills/edit", get(skills::edit_form))
        .route("/skills/save", post(skills::save))
        .route(
            "/skills/delete",
            delete(skills::delete).post(skills::delete),
        )
}
