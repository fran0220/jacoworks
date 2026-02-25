use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub server: ServerConfig,
    pub database: DatabaseConfig,
    pub gateway: GatewayConfig,
    pub site: SiteConfig,
    pub cookie_secret: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct GatewayConfig {
    pub url: String,
    pub admin_token: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SiteConfig {
    pub name: String,
    pub description: String,
    pub base_url: String,
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    9527
}

impl Config {
    pub fn load(path: &str) -> Result<Config, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(Path::new(path))?;
        let mut config: Config = toml::from_str(&content)?;

        // Allow env override for database URL
        if let Ok(url) = std::env::var("WEBSITE_DATABASE_URL") {
            config.database.url = url;
        }

        Ok(config)
    }
}
