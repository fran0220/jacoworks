package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Project      ProjectConfig      `yaml:"project"`
	Admin        AdminConfig        `yaml:"admin"`
	Agent        AgentConfig        `yaml:"agent"`
	Notification NotificationConfig `yaml:"notification"`
	Server       ServerConfig       `yaml:"server"`
	Database     DatabaseConfig     `yaml:"database"`
	Workspace    WorkspaceConfig    `yaml:"workspace"`
	WebUI        WebUIConfig        `yaml:"webui"`
}

type ProjectConfig struct {
	Name string `yaml:"name"`
}

type AdminConfig struct {
	Password string `yaml:"password"`
}

type AgentConfig struct {
	RegistrationToken string `yaml:"registration_token"`
	AllowRegistration bool   `yaml:"allow_registration"`
}

type NotificationConfig struct {
	Enabled  bool     `yaml:"enabled"`
	Channels []string `yaml:"channels"`
	Events   []string `yaml:"events"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

type DatabaseConfig struct {
	Type string `yaml:"type"`
	Path string `yaml:"path"`
}

type WorkspaceConfig struct {
	Root string `yaml:"root"`
}

type WebUIConfig struct {
	PublicFeed        bool `yaml:"public_feed"`
	FeedRetentionDays int  `yaml:"feed_retention_days"`
}

func Load(path string) (*Config, error) {
	cfg := defaults()

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func defaults() *Config {
	return &Config{
		Project: ProjectConfig{Name: "JMOS"},
		Admin:   AdminConfig{Password: "admin123"},
		Agent: AgentConfig{
			RegistrationToken: "openclaw-register-2024",
			AllowRegistration: true,
		},
		Notification: NotificationConfig{
			Enabled: true,
			Events:  []string{"task_completed", "review_rejected", "all_done", "patrol_alert"},
		},
		Server: ServerConfig{
			Port: 6565,
			Host: "0.0.0.0",
		},
		Database: DatabaseConfig{
			Type: "sqlite",
			Path: "./data/tasks.db",
		},
		Workspace: WorkspaceConfig{Root: "./workspace"},
		WebUI: WebUIConfig{
			PublicFeed:        false,
			FeedRetentionDays: 7,
		},
	}
}
