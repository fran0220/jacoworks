package config

import (
	"fmt"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Auth     AuthConfig     `yaml:"auth"`
	LXD      LXDConfig      `yaml:"lxd"`
	LLM      LLMConfig      `yaml:"llm"`
	Database DatabaseConfig `yaml:"database"`
}

type LLMConfig struct {
	ProxyURL string `yaml:"proxy_url"`
	ProxyKey string `yaml:"proxy_key"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

type AuthConfig struct {
	JWTSecret  string `yaml:"jwt_secret"`
	AdminToken string `yaml:"admin_token"`
}

type LXDConfig struct {
	SSHTarget    string `yaml:"ssh_target"`
	Socket       string `yaml:"socket"`
	Template     string `yaml:"template"`
	Network      string `yaml:"network"`
	OpenClawPort int    `yaml:"openclaw_port"`
}

type DatabaseConfig struct {
	Path string `yaml:"path"`
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
	if v := os.Getenv("GATEWAY_AUTH_JWT_SECRET"); v != "" {
		cfg.Auth.JWTSecret = v
	}
	if v := os.Getenv("GATEWAY_AUTH_ADMIN_TOKEN"); v != "" {
		cfg.Auth.AdminToken = v
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
	if v := os.Getenv("GATEWAY_DATABASE_PATH"); v != "" {
		cfg.Database.Path = v
	}
	if v := os.Getenv("GATEWAY_LLM_PROXY_URL"); v != "" {
		cfg.LLM.ProxyURL = v
	}
	if v := os.Getenv("GATEWAY_LLM_PROXY_KEY"); v != "" {
		cfg.LLM.ProxyKey = v
	}
}

func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Server.Host, c.Server.Port)
}
