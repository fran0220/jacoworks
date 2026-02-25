-- JAcoworks System Settings
-- Run after 002_website_tables.sql

CREATE TABLE IF NOT EXISTS system_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger
CREATE TRIGGER trg_system_settings_updated
    BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed default keys (empty values, admin fills via UI)
INSERT INTO system_settings (key, description) VALUES
    ('llm_proxy_url', 'LLM 中转站地址'),
    ('llm_proxy_key', 'LLM 中转站密钥'),
    ('openai_api_key', 'OpenAI API 密钥 (Embedding 向量搜索)'),
    ('exa_api_key', 'Exa 搜索 API 密钥'),
    ('tavily_api_key', 'Tavily 搜索 API 密钥')
ON CONFLICT (key) DO NOTHING;
