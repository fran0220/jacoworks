use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SystemSetting {
    pub key: String,
    pub value: String,
    pub description: String,
}

/// Client for proxying admin operations to the Go gateway.
pub struct GatewayClient {
    http: reqwest::Client,
    base_url: String,
    admin_token: String,
}

impl GatewayClient {
    pub fn new(http: reqwest::Client, base_url: String, admin_token: String) -> Self {
        Self {
            http,
            base_url,
            admin_token,
        }
    }

    pub async fn health(&self) -> Result<bool, AppError> {
        let resp = self
            .http
            .get(format!("{}/health", self.base_url))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("gateway health check failed: {e}")))?;
        Ok(resp.status().is_success())
    }

    pub async fn start_container(&self, id: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .post(format!(
                "{}/api/admin/containers/{}/start",
                self.base_url, id
            ))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("start container failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "start container failed ({status}): {body}"
            )));
        }

        Ok(())
    }

    pub async fn stop_container(&self, id: &str) -> Result<(), AppError> {
        let resp = self
            .http
            .post(format!(
                "{}/api/admin/containers/{}/stop",
                self.base_url, id
            ))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("stop container failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "stop container failed ({status}): {body}"
            )));
        }

        Ok(())
    }

    pub async fn get_settings(&self) -> Result<Vec<SystemSetting>, AppError> {
        let resp = self
            .http
            .get(format!("{}/api/admin/settings", self.base_url))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("get settings failed: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "failed to fetch settings from gateway ({status}): {body}"
            )));
        }
        resp.json::<Vec<SystemSetting>>()
            .await
            .map_err(|e| AppError::Internal(format!("parse settings failed: {e}")))
    }

    pub async fn update_settings(
        &self,
        settings: std::collections::HashMap<String, String>,
    ) -> Result<(), AppError> {
        let body = serde_json::json!({ "settings": settings });
        let resp = self
            .http
            .put(format!("{}/api/admin/settings", self.base_url))
            .header("Authorization", format!("Bearer {}", self.admin_token))
            .json(&body)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("update settings failed: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "failed to update settings ({status}): {body}"
            )));
        }
        Ok(())
    }
}
