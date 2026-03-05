package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad_ParsesYAMLAndAppliesDefaults(t *testing.T) {
	t.Parallel()

	path := writeConfigFile(t, `
database:
  url: postgresql://user:pass@localhost:5432/jacoworks
`)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Database.URL != "postgresql://user:pass@localhost:5432/jacoworks" {
		t.Fatalf("database url = %q", cfg.Database.URL)
	}
	if cfg.Server.Port != 8080 {
		t.Fatalf("server port = %d, want %d", cfg.Server.Port, 8080)
	}
	if cfg.Server.Host != "0.0.0.0" {
		t.Fatalf("server host = %q, want %q", cfg.Server.Host, "0.0.0.0")
	}
	if cfg.Auth.SessionTTLHours != 720 {
		t.Fatalf("session ttl hours = %d, want %d", cfg.Auth.SessionTTLHours, 720)
	}
	if cfg.Docker.AgentPort != 18789 {
		t.Fatalf("agent port = %d, want %d", cfg.Docker.AgentPort, 18789)
	}
	if cfg.Docker.Image != "jacoworks/vm-agent:latest" {
		t.Fatalf("docker image = %q, want %q", cfg.Docker.Image, "jacoworks/vm-agent:latest")
	}
}

func TestLoad_InvalidYAMLReturnsError(t *testing.T) {
	t.Parallel()

	path := writeConfigFile(t, "server: [")
	_, err := Load(path)
	if err == nil {
		t.Fatalf("expected parse error")
	}
	if !strings.Contains(err.Error(), "parse config") {
		t.Fatalf("error = %v, want parse config error", err)
	}
}

func TestLoad_MissingRequiredDatabaseURLReturnsError(t *testing.T) {
	t.Parallel()

	path := writeConfigFile(t, "server:\n  port: 8847\n")
	_, err := Load(path)
	if err == nil {
		t.Fatalf("expected required field error")
	}
	if !strings.Contains(err.Error(), "database.url is required") {
		t.Fatalf("error = %v, want missing database.url error", err)
	}
}

func TestLoad_EnvOverrides(t *testing.T) {
	path := writeConfigFile(t, `
server:
  host: 0.0.0.0
  port: 8080
database:
  url: postgresql://yaml-value
llm:
  proxy_url: http://yaml-proxy
`)

	t.Setenv("GATEWAY_SERVER_HOST", "127.0.0.1")
	t.Setenv("GATEWAY_SERVER_PORT", "9999")
	t.Setenv("GATEWAY_DATABASE_URL", "postgresql://env-value")
	t.Setenv("GATEWAY_LLM_PROXY_URL", "http://env-proxy")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Server.Host != "127.0.0.1" {
		t.Fatalf("server host = %q, want %q", cfg.Server.Host, "127.0.0.1")
	}
	if cfg.Server.Port != 9999 {
		t.Fatalf("server port = %d, want %d", cfg.Server.Port, 9999)
	}
	if cfg.Database.URL != "postgresql://env-value" {
		t.Fatalf("database url = %q, want %q", cfg.Database.URL, "postgresql://env-value")
	}
	if cfg.LLM.ProxyURL != "http://env-proxy" {
		t.Fatalf("llm proxy url = %q, want %q", cfg.LLM.ProxyURL, "http://env-proxy")
	}
}

func TestAddr(t *testing.T) {
	t.Parallel()

	cfg := &Config{Server: ServerConfig{Host: "127.0.0.1", Port: 8847}}
	if got := cfg.Addr(); got != "127.0.0.1:8847" {
		t.Fatalf("Addr() = %q, want %q", got, "127.0.0.1:8847")
	}
}

func TestGetLLMAndUpdateLLM(t *testing.T) {
	t.Parallel()

	cfg := &Config{}
	want := LLMConfig{ProxyURL: "http://proxy", ProxyKey: "secret", OpenAIAPIKey: "openai-key"}
	cfg.UpdateLLM(want)

	got := cfg.GetLLM()
	if got != want {
		t.Fatalf("GetLLM() = %+v, want %+v", got, want)
	}

	got.ProxyURL = "changed"
	if cfg.GetLLM().ProxyURL != want.ProxyURL {
		t.Fatalf("GetLLM() should return a value copy")
	}
}

func writeConfigFile(t *testing.T, content string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "gateway.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config file: %v", err)
	}
	return path
}
