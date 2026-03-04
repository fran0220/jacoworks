use reqwest::{Client, StatusCode};
use serde::Deserialize;
use std::time::Duration;

const BASE_URL_ENV: &str = "WEBSITE_SMOKE_BASE_URL";
const DEFAULT_BASE_URL: &str = "http://127.0.0.1:9527";

#[derive(Clone)]
struct SmokeTarget {
    base_url: String,
    client: Client,
}

impl SmokeTarget {
    async fn get(&self, path: &str) -> reqwest::Response {
        let url = join_url(&self.base_url, path);
        self.client
            .get(&url)
            .send()
            .await
            .unwrap_or_else(|err| panic!("request failed for {url}: {err}"))
    }
}

#[derive(Deserialize)]
struct UpdatePayload {
    version: String,
}

fn join_url(base: &str, path: &str) -> String {
    format!("{}{path}", base.trim_end_matches('/'))
}

async fn resolve_target() -> Option<SmokeTarget> {
    let base_url = std::env::var(BASE_URL_ENV).unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());

    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("failed to build reqwest client");

    let probe_url = join_url(&base_url, "/");
    match client.get(&probe_url).send().await {
        Ok(_) => Some(SmokeTarget { base_url, client }),
        Err(err) => {
            eprintln!(
                "[website-smoke] skip: cannot reach {probe_url}. \
                 Start website dev server or set {BASE_URL_ENV}. error={err}"
            );
            None
        }
    }
}

#[tokio::test]
async fn homepage_returns_200_and_branding() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/").await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = response
        .text()
        .await
        .expect("failed to read homepage response body");
    assert!(
        body.contains("JAcoworks"),
        "homepage should contain JAcoworks branding"
    );
}

#[tokio::test]
async fn download_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/download").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn about_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/about").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn docs_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/docs").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn feedback_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/feedback").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn games_gallery_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/games").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn static_css_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/static/css/style.css").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn admin_login_page_returns_200() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/admin/login").await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn update_api_supports_no_update_204_flow() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/api/update/darwin/aarch64/0.0.0").await;
    match response.status() {
        StatusCode::NO_CONTENT => {}
        StatusCode::OK => {
            let payload: UpdatePayload = response
                .json()
                .await
                .expect("failed to parse update API JSON response");
            let no_update_path = format!("/api/update/darwin/aarch64/{}", payload.version);
            let no_update = target.get(&no_update_path).await;
            assert_eq!(
                no_update.status(),
                StatusCode::NO_CONTENT,
                "expected 204 when requesting current version"
            );
        }
        other => panic!("expected update API to return 204 or 200, got {other}"),
    }
}

#[tokio::test]
async fn health_endpoint_returns_200_if_exposed() {
    let Some(target) = resolve_target().await else {
        return;
    };

    let response = target.get("/health").await;
    if response.status() == StatusCode::NOT_FOUND {
        eprintln!("[website-smoke] /health not exposed; skipping status assertion");
        return;
    }

    assert_eq!(response.status(), StatusCode::OK);
}
