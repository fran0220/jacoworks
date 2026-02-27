package config

import (
	"fmt"
	"os"
	"strconv"
	"sync"

	"gopkg.in/yaml.v3"
)

type Config struct {
	llmMu     sync.RWMutex    `yaml:"-"`
	Server    ServerConfig    `yaml:"server"`
	Auth      AuthConfig      `yaml:"auth"`
	LXD       LXDConfig       `yaml:"lxd"`
	LLM       LLMConfig       `yaml:"llm"`
	Database  DatabaseConfig  `yaml:"database"`
	ChatAgent ChatAgentConfig `yaml:"chat_agent"`
}

type ChatAgentConfig struct {
	URL   string `yaml:"url"`
	Token string `yaml:"token"`
}

type LLMConfig struct {
	ProxyURL         string `yaml:"proxy_url"`
	ProxyKey         string `yaml:"proxy_key"`
	ExaAPIKey        string `yaml:"exa_api_key"`
	TavilyKey        string `yaml:"tavily_api_key"`
	OpenAIAPIKey     string `yaml:"openai_api_key"`
	EmbeddingBaseURL string `yaml:"embedding_base_url"`
	EmbeddingAPIKey  string `yaml:"embedding_api_key"`
	FalAPIKey        string `yaml:"fal_api_key"`
	JimengAPIURL     string `yaml:"jimeng_api_url"`
	JimengAPIKey     string `yaml:"jimeng_api_key"`
}

type ServerConfig struct {
	Port      int    `yaml:"port"`
	Host      string `yaml:"host"`
	PublicURL string `yaml:"public_url"`
}

type AuthConfig struct {
	AdminToken         string `yaml:"admin_token"`
	FeishuClientID     string `yaml:"feishu_client_id"`
	FeishuClientSecret string `yaml:"feishu_client_secret"`
	SessionTTLHours    int    `yaml:"session_ttl_hours"`
}

type LXDConfig struct {
	SSHTarget    string `yaml:"ssh_target"`
	Socket       string `yaml:"socket"`
	Template     string `yaml:"template"`
	Network      string `yaml:"network"`
	OpenClawPort int    `yaml:"openclaw_port"`
}

type DatabaseConfig struct {
	URL string `yaml:"url"`
}

func Load(path string) (*Config, error) {
	cfg := &Config{}

	data, err := os.ReadFile(path)
	if err == nil {
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("parse config: %w", err)
		}
	}
	// Missing file is OK — env vars provide all values on Railway

	// Defaults
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Server.Host == "" {
		cfg.Server.Host = "0.0.0.0"
	}
	if cfg.Auth.SessionTTLHours == 0 {
		cfg.Auth.SessionTTLHours = 720
	}
	if cfg.LXD.OpenClawPort == 0 {
		cfg.LXD.OpenClawPort = 18789
	}

	applyEnvOverrides(cfg)

	return cfg, nil
}

func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("GATEWAY_SERVER_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = port
		}
	}
	if v := os.Getenv("GATEWAY_SERVER_HOST"); v != "" {
		cfg.Server.Host = v
	}
	if v := os.Getenv("GATEWAY_SERVER_PUBLIC_URL"); v != "" {
		cfg.Server.PublicURL = v
	}
	if v := os.Getenv("GATEWAY_AUTH_ADMIN_TOKEN"); v != "" {
		cfg.Auth.AdminToken = v
	}
	if v := os.Getenv("GATEWAY_AUTH_FEISHU_CLIENT_ID"); v != "" {
		cfg.Auth.FeishuClientID = v
	}
	if v := os.Getenv("GATEWAY_AUTH_FEISHU_CLIENT_SECRET"); v != "" {
		cfg.Auth.FeishuClientSecret = v
	}
	if v := os.Getenv("GATEWAY_AUTH_SESSION_TTL_HOURS"); v != "" {
		if ttl, err := strconv.Atoi(v); err == nil {
			cfg.Auth.SessionTTLHours = ttl
		}
	}
	if v := os.Getenv("GATEWAY_LXD_SSH_TARGET"); v != "" {
		cfg.LXD.SSHTarget = v
	}
	if v := os.Getenv("GATEWAY_LXD_SOCKET"); v != "" {
		cfg.LXD.Socket = v
	}
	if v := os.Getenv("GATEWAY_LXD_TEMPLATE"); v != "" {
		cfg.LXD.Template = v
	}
	if v := os.Getenv("GATEWAY_LXD_OPENCLAW_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.LXD.OpenClawPort = port
		}
	}
	if v := os.Getenv("GATEWAY_DATABASE_URL"); v != "" {
		cfg.Database.URL = v
	}
	if v := os.Getenv("GATEWAY_LLM_PROXY_URL"); v != "" {
		cfg.LLM.ProxyURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_PROXY_KEY"); v != "" {
		cfg.LLM.ProxyKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_EXA_API_KEY"); v != "" {
		cfg.LLM.ExaAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_TAVILY_API_KEY"); v != "" {
		cfg.LLM.TavilyKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_OPENAI_API_KEY"); v != "" {
		cfg.LLM.OpenAIAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_FAL_API_KEY"); v != "" {
		cfg.LLM.FalAPIKey = v
	}
	if v := os.Getenv("GATEWAY_LLM_JIMENG_API_URL"); v != "" {
		cfg.LLM.JimengAPIURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_JIMENG_API_KEY"); v != "" {
		cfg.LLM.JimengAPIKey = v
	}
	if v := os.Getenv("GATEWAY_CHAT_AGENT_URL"); v != "" {
		cfg.ChatAgent.URL = v
	}
	if v := os.Getenv("GATEWAY_CHAT_AGENT_TOKEN"); v != "" {
		cfg.ChatAgent.Token = v
	}
}

func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}

func (c *Config) GetLLM() LLMConfig {
	c.llmMu.RLock()
	defer c.llmMu.RUnlock()
	return c.LLM
}

func (c *Config) UpdateLLM(llm LLMConfig) {
	c.llmMu.Lock()
	defer c.llmMu.Unlock()
	c.LLM = llm
}
