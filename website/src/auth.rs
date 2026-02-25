use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::response::Redirect;
use tower_cookies::Cookies;

use crate::error::AppError;
use crate::models::user::User;
use crate::AppState;

const SESSION_COOKIE: &str = "admin_session";

/// Verify admin credentials and return the user.
/// Supports both bcrypt (Go gateway format: `$2a$...`) and sha256 (legacy).
pub async fn admin_login(db: &sqlx::PgPool, email: &str, password: &str) -> Result<User, AppError> {
    let row = sqlx::query_as::<_, UserWithHash>(
        "SELECT id, name, email, password_hash, role, created_at, updated_at FROM users WHERE email = $1 AND role = 'admin'",
    )
    .bind(email)
    .fetch_optional(db)
    .await?;

    let user = row.ok_or(AppError::Unauthorized)?;
    let stored = user.password_hash.as_deref().ok_or(AppError::Unauthorized)?;

    let valid = if stored.starts_with("$2a$") || stored.starts_with("$2b$") {
        bcrypt::verify(password, stored).unwrap_or(false)
    } else {
        sha256_hex(password) == stored
    };

    if !valid {
        return Err(AppError::Unauthorized);
    }

    Ok(User {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at,
    })
}

fn sha256_hex(input: &str) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a random session token.
pub fn generate_token() -> String {
    use sha2::Digest;
    let random_bytes: [u8; 32] = rand_bytes();
    hex::encode(sha2::Sha256::digest(random_bytes))
}

fn rand_bytes() -> [u8; 32] {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .subsec_nanos();
    let mut buf = [0u8; 32];
    // Simple pseudo-random; adequate for dev. In production use a proper CSPRNG.
    for (i, b) in buf.iter_mut().enumerate() {
        *b = ((nanos.wrapping_mul(i as u32 + 1)) & 0xFF) as u8;
    }
    buf
}

/// Set the admin session cookie after successful login.
pub fn set_session_cookie(cookies: &Cookies, token: &str) {
    use tower_cookies::Cookie;
    let mut cookie = Cookie::new(SESSION_COOKIE, token.to_string());
    cookie.set_path("/");
    cookie.set_http_only(true);
    cookie.set_same_site(tower_cookies::cookie::SameSite::Lax);
    cookies.add(cookie);
}

/// Remove the admin session cookie.
pub fn remove_session_cookie(cookies: &Cookies) {
    use tower_cookies::Cookie;
    let mut cookie = Cookie::new(SESSION_COOKIE, "");
    cookie.set_path("/");
    cookie.set_max_age(tower_cookies::cookie::time::Duration::seconds(0));
    cookies.add(cookie);
}

/// Axum extractor that enforces admin authentication.
/// Extracts the authenticated admin user from the session cookie.
#[derive(Debug, Clone)]
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = Redirect;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let cookies = Cookies::from_request_parts(parts, state)
            .await
            .map_err(|_| Redirect::to("/admin/login"))?;

        let token = cookies
            .get(SESSION_COOKIE)
            .map(|c| c.value().to_string())
            .ok_or_else(|| Redirect::to("/admin/login"))?;

        if token.is_empty() {
            return Err(Redirect::to("/admin/login"));
        }

        let session = crate::models::auth_session::get_session_by_token(&state.db, &token)
            .await
            .map_err(|_| Redirect::to("/admin/login"))?;

        let (user_id, role) = session.ok_or_else(|| Redirect::to("/admin/login"))?;

        if role != "admin" {
            return Err(Redirect::to("/admin/login"));
        }

        let user = crate::models::user::get_user(&state.db, &user_id)
            .await
            .map_err(|_| Redirect::to("/admin/login"))?
            .ok_or_else(|| Redirect::to("/admin/login"))?;

        Ok(AdminUser(user))
    }
}

#[derive(Debug, sqlx::FromRow)]
struct UserWithHash {
    pub id: String,
    pub name: String,
    pub email: String,
    pub password_hash: Option<String>,
    pub role: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}
