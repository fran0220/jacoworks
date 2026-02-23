package config

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

type Config struct {
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
	ProxyURL string `yaml:"proxy_url"`
	ProxyKey string `yaml:"proxy_key"`
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
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config file: %w", err)
	}

	cfg := &Config{}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
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
