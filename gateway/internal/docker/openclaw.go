package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
)

// OpenClawClient wraps a docker Client for OpenClaw-specific container operations.
type OpenClawClient struct {
	client   *Client
	dataRoot string
	getLLM   func() config.LLMConfig
}

// NewOpenClawClient creates a new OpenClawClient.
func NewOpenClawClient(client *Client, dataRoot string, getLLM func() config.LLMConfig) *OpenClawClient {
	return &OpenClawClient{
		client:   client,
		dataRoot: dataRoot,
		getLLM:   getLLM,
	}
}

// openclawConfig is the JSON structure for openclaw.json.
type openclawConfig struct {
	Models   openclawModels   `json:"models"`
	Agents   openclawAgents   `json:"agents"`
	Tools    openclawTools    `json:"tools"`
	Commands openclawCommands `json:"commands"`
	Session  openclawSession  `json:"session"`
	Gateway  openclawGateway  `json:"gateway"`
}

type openclawModels struct {
	Mode      string                        `json:"mode"`
	Providers map[string]openclawProvider    `json:"providers"`
}

type openclawProvider struct {
	BaseURL string          `json:"baseUrl"`
	APIKey  string          `json:"apiKey"`
	API     string          `json:"api"`
	Models  []openclawModel `json:"models"`
}

type openclawModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	ContextWindow int    `json:"contextWindow"`
	MaxTokens     int    `json:"maxTokens"`
	Reasoning     bool   `json:"reasoning,omitempty"`
}

type openclawAgents struct {
	Defaults openclawAgentDefaults `json:"defaults"`
}

type openclawAgentDefaults struct {
	Model      openclawModelRef      `json:"model"`
	Workspace  string                `json:"workspace"`
	Compaction openclawCompaction    `json:"compaction"`
	Sandbox    openclawSandbox       `json:"sandbox"`
}

type openclawModelRef struct {
	Primary string `json:"primary"`
}

type openclawCompaction struct {
	Mode               string              `json:"mode"`
	ReserveTokensFloor int                 `json:"reserveTokensFloor"`
	MemoryFlush        openclawMemoryFlush `json:"memoryFlush"`
}

type openclawMemoryFlush struct {
	Enabled             bool `json:"enabled"`
	SoftThresholdTokens int  `json:"softThresholdTokens"`
}

type openclawSandbox struct {
	Mode string `json:"mode"`
}

type openclawTools struct {
	Deny []string `json:"deny"`
}

type openclawCommands struct {
	Native       string `json:"native"`
	NativeSkills string `json:"nativeSkills"`
	Restart      bool   `json:"restart"`
}

type openclawSession struct {
	DMScope string             `json:"dmScope"`
	Reset   openclawResetMode  `json:"reset"`
}

type openclawResetMode struct {
	Mode string `json:"mode"`
}

type openclawGateway struct {
	Port           int                    `json:"port"`
	Bind           string                 `json:"bind"`
	Auth           openclawAuth           `json:"auth"`
	ControlUI      openclawControlUI      `json:"controlUi"`
	TrustedProxies []string               `json:"trustedProxies,omitempty"`
}

type openclawAuth struct {
	Mode  string `json:"mode"`
	Token string `json:"token"`
}

type openclawControlUI struct {
	AllowedOrigins                  []string `json:"allowedOrigins"`
	DangerouslyDisableDeviceAuth    bool     `json:"dangerouslyDisableDeviceAuth,omitempty"`
}

// GenerateConfig generates openclaw.json content as JSON bytes.
func (oc *OpenClawClient) GenerateConfig(token string, llm config.LLMConfig) ([]byte, error) {
	primaryModel := "proxy/gpt-5.4"
	if llm.PrimaryModel != "" {
		if strings.Contains(llm.PrimaryModel, "/") {
			primaryModel = llm.PrimaryModel
		} else {
			primaryModel = "proxy/" + llm.PrimaryModel
		}
	}

	cfg := openclawConfig{
		Models: openclawModels{
			Mode: "merge",
			Providers: map[string]openclawProvider{
				"proxy": {
					BaseURL: llm.ProxyURL + "/v1",
					APIKey:  "${LLM_PROXY_KEY}",
					API:     "openai-completions",
					Models: []openclawModel{
						{ID: "gpt-5.4", Name: "GPT 5.4", ContextWindow: 128000, MaxTokens: 16384},
						{ID: "claude-sonnet-4-6", Name: "Sonnet 4.6", ContextWindow: 200000, MaxTokens: 16384},
						{ID: "claude-opus-4-6", Name: "Opus 4.6", ContextWindow: 200000, MaxTokens: 32000, Reasoning: true},
						{ID: "grok-4.1-fast", Name: "Grok 4.1 Fast", ContextWindow: 131072, MaxTokens: 16384},
						{ID: "gemini-3.1-pro-preview", Name: "Gemini 3.1 Pro", ContextWindow: 1000000, MaxTokens: 8192},
					},
				},
			},
		},
		Agents: openclawAgents{
			Defaults: openclawAgentDefaults{
				Model:     openclawModelRef{Primary: primaryModel},
				Workspace: "/data/workspace",
				Compaction: openclawCompaction{
					Mode:               "safeguard",
					ReserveTokensFloor: 32768,
					MemoryFlush: openclawMemoryFlush{
						Enabled:             true,
						SoftThresholdTokens: 6000,
					},
				},
				Sandbox: openclawSandbox{Mode: "off"},
			},
		},
		Tools:    openclawTools{Deny: []string{"gateway"}},
		Commands: openclawCommands{Native: "auto", NativeSkills: "auto", Restart: true},
		Session:  openclawSession{DMScope: "per-channel-peer", Reset: openclawResetMode{Mode: "idle"}},
		Gateway: openclawGateway{
			Port: 18789,
			Bind: "lan",
			Auth: openclawAuth{Mode: "token", Token: token},
			ControlUI: openclawControlUI{
				AllowedOrigins: []string{
					"http://localhost:18789",
					"http://127.0.0.1:18789",
					fmt.Sprintf("http://%s:%d", oc.client.hostIP, oc.client.agentPort),
				},
				DangerouslyDisableDeviceAuth: true,
			},
			TrustedProxies: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"},
		},
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// WriteConfig generates and writes openclaw.json to the host filesystem via SSH.
func (oc *OpenClawClient) WriteConfig(userID, token string) error {
	llm := oc.getLLM()
	data, err := oc.GenerateConfig(token, llm)
	if err != nil {
		return fmt.Errorf("generate openclaw config: %w", err)
	}

	userDir := fmt.Sprintf("%s/%s", oc.dataRoot, userID)
	configDir := userDir + "/.openclaw"

	if _, err := oc.client.ssh("mkdir", "-p", configDir); err != nil {
		return fmt.Errorf("mkdir config dir: %w", err)
	}
	if _, err := oc.client.ssh("mkdir", "-p", userDir+"/workspace"); err != nil {
		return fmt.Errorf("mkdir workspace dir: %w", err)
	}

	configPath := configDir + "/openclaw.json"
	escaped := strings.ReplaceAll(string(data), "'", "'\\''")
	writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s", escaped, configPath)
	if _, err := oc.client.ssh("bash", "-c", fmt.Sprintf("'%s'", writeCmd)); err != nil {
		return fmt.Errorf("write config: %w", err)
	}

	if _, err := oc.client.ssh("chown", "-R", "1000:1000", userDir); err != nil {
		return fmt.Errorf("chown user dir: %w", err)
	}

	log.Info().Str("user_id", userID).Str("path", configPath).Msg("openclaw config written")
	return nil
}

// ContainerEnvVars builds the environment variables map for an OpenClaw container.
func (oc *OpenClawClient) ContainerEnvVars() map[string]string {
	llm := oc.getLLM()
	envs := map[string]string{}

	set := func(key, val string) {
		if val != "" {
			envs[key] = val
		}
	}

	set("LLM_PROXY_URL", llm.ProxyURL)
	set("LLM_PROXY_KEY", llm.ProxyKey)
	set("OPENAI_API_KEY", llm.OpenAIAPIKey)
	set("EXA_API_KEY", llm.ExaAPIKey)
	set("TAVILY_API_KEY", llm.TavilyKey)
	set("FAL_API_KEY", llm.FalAPIKey)
	set("JIMENG_API_URL", llm.JimengAPIURL)
	set("JIMENG_API_KEY", llm.JimengAPIKey)
	set("EMBEDDING_BASE_URL", llm.EmbeddingBaseURL)
	set("EMBEDDING_API_KEY", llm.EmbeddingAPIKey)

	return envs
}

// Provision creates and starts a new OpenClaw container for a user.
func (oc *OpenClawClient) Provision(name, userID, token string, hostPort int) (string, error) {
	log.Info().Str("name", name).Str("user_id", userID).Int("host_port", hostPort).Msg("provisioning openclaw container")

	if err := oc.WriteConfig(userID, token); err != nil {
		return "", fmt.Errorf("write config: %w", err)
	}

	userDir := fmt.Sprintf("%s/%s", oc.dataRoot, userID)

	args := []string{
		"run", "-d",
		"--name", name,
		"--restart", "unless-stopped",
		"--label", "jacoworks.managed=true",
		"--label", "jacoworks.type=openclaw",
		"--label", fmt.Sprintf("jacoworks.user_id=%s", userID),
		"--health-cmd", "curl -fsS http://127.0.0.1:18789/healthz || exit 1",
		"--health-interval", "30s",
		"--health-timeout", "5s",
		"--health-retries", "3",
		"-v", fmt.Sprintf("%s/.openclaw:/home/node/.openclaw", userDir),
		"-v", fmt.Sprintf("%s/workspace:/data/workspace", userDir),
		"-p", fmt.Sprintf("%d:18789", hostPort),
	}

	envVars := oc.ContainerEnvVars()
	envVars["OPENCLAW_GATEWAY_TOKEN"] = token
	for k, v := range envVars {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}

	args = append(args, oc.client.image)

	if _, err := oc.client.docker(args...); err != nil {
		return "", fmt.Errorf("docker run %s: %w", name, err)
	}

	time.Sleep(3 * time.Second)

	healthURL := fmt.Sprintf("http://%s:%d/healthz", oc.client.hostIP, hostPort)
	if err := oc.waitForHealthURL(healthURL, 60*time.Second); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("openclaw container started but health check failed")
	}

	log.Info().Str("name", name).Str("host_ip", oc.client.hostIP).Int("host_port", hostPort).Msg("openclaw container provisioned")
	return oc.client.hostIP, nil
}

// waitForHealthURL polls a URL until it returns HTTP 200.
func (oc *OpenClawClient) waitForHealthURL(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 --max-time 5 %s", url)

	log.Debug().Str("url", url).Dur("timeout", timeout).Msg("waiting for openclaw health")

	for time.Now().Before(deadline) {
		out, err := oc.client.ssh(curlCmd)
		if err == nil {
			code := strings.TrimSpace(strings.Trim(out, "'"))
			if code == "200" {
				log.Info().Str("url", url).Msg("openclaw container healthy")
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("openclaw at %s not healthy after %s", url, timeout)
}

// EnsureRunning checks the container status and brings it to a running state.
func (oc *OpenClawClient) EnsureRunning(ctx context.Context, info *store.ContainerInfo) error {
	status, err := oc.client.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	healthURL := fmt.Sprintf("http://%s:%d/healthz", oc.client.hostIP, info.HostPort)

	switch status.Status {
	case "running":
		return oc.waitForHealthURL(healthURL, 15*time.Second)
	case "paused":
		if err := oc.client.Unpause(info.ContainerName); err != nil {
			return fmt.Errorf("unpause: %w", err)
		}
		return oc.waitForHealthURL(healthURL, 30*time.Second)
	case "exited":
		if err := oc.client.Start(info.ContainerName); err != nil {
			return fmt.Errorf("start: %w", err)
		}
		time.Sleep(2 * time.Second)
		return oc.waitForHealthURL(healthURL, 30*time.Second)
	case "not_found":
		log.Info().Str("name", info.ContainerName).Str("user_id", info.UserID).Msg("openclaw container not found, reprovisioning")
		if _, err := oc.Provision(info.ContainerName, info.UserID, info.ContainerToken, info.HostPort); err != nil {
			return fmt.Errorf("reprovision %s: %w", info.ContainerName, err)
		}
		return nil
	default:
		return fmt.Errorf("container %s in unexpected state: %s", info.ContainerName, status.Status)
	}
}

// UpstreamAddr returns the WebSocket upstream address for an OpenClaw container.
// Uses the container's own IP from DB if available, falling back to the docker client's host IP.
func (oc *OpenClawClient) UpstreamAddr(info *store.ContainerInfo) string {
	host := oc.client.hostIP
	if info.ContainerIP != "" {
		host = info.ContainerIP
	}
	port := info.HostPort
	if port == 0 {
		port = oc.client.agentPort
	}
	return fmt.Sprintf("ws://%s:%d", host, port)
}
