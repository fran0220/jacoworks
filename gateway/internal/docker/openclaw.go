package docker

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/go-connections/nat"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
)

// OpenClawClient wraps a docker Client for OpenClaw-specific container operations.
type OpenClawClient struct {
	client   *Client
	dataRoot string
	getLLM   func() config.LLMConfig
	store    *store.Store
}

// NewOpenClawClient creates a new OpenClawClient.
func NewOpenClawClient(client *Client, dataRoot string, getLLM func() config.LLMConfig, s *store.Store) *OpenClawClient {
	return &OpenClawClient{
		client:   client,
		dataRoot: dataRoot,
		getLLM:   getLLM,
		store:    s,
	}
}

// DockerClient returns the underlying Docker client for direct container operations.
func (oc *OpenClawClient) DockerClient() *Client {
	return oc.client
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
// Deprecated: Use GenerateConfigFromDB which reads providers/models from DB.
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
			},
			TrustedProxies: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"},
		},
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// GenerateConfigFromDB generates openclaw.json from DB-backed providers and models.
// Falls back to the hardcoded GenerateConfig if the DB query fails or returns no providers.
func (oc *OpenClawClient) GenerateConfigFromDB(ctx context.Context, token string) ([]byte, error) {
	if oc.store == nil {
		llm := oc.getLLM()
		return oc.GenerateConfig(token, llm)
	}

	providers, err := oc.store.ListProviders(ctx)
	if err != nil || len(providers) == 0 {
		if err != nil {
			log.Warn().Err(err).Msg("openclaw config: DB providers query failed, using hardcoded fallback")
		} else {
			log.Warn().Msg("openclaw config: no providers in DB, using hardcoded fallback")
		}
		llm := oc.getLLM()
		return oc.GenerateConfig(token, llm)
	}

	llm := oc.getLLM()

	// Build providers map from DB
	ocProviders := make(map[string]openclawProvider)
	for _, p := range providers {
		if !p.Enabled {
			continue
		}

		models, err := oc.store.ListModelsByProvider(ctx, p.Key)
		if err != nil {
			log.Warn().Err(err).Str("provider", p.Key).Msg("openclaw config: list models failed, skipping provider")
			continue
		}

		var ocModels []openclawModel
		for _, m := range models {
			if !m.Enabled {
				continue
			}
			ocModels = append(ocModels, openclawModel{
				ID:            m.ModelID,
				Name:          m.DisplayName,
				ContextWindow: m.ContextWindow,
				MaxTokens:     m.MaxTokens,
				Reasoning:     m.Reasoning,
			})
		}

		if len(ocModels) == 0 {
			continue
		}

		// Resolve API key: use the ref to look up from system_settings
		apiKey := "${LLM_PROXY_KEY}"
		if p.APIKeyRef != "" && p.APIKeyRef != "llm_proxy_key" {
			if val, err := oc.store.GetSetting(ctx, p.APIKeyRef); err == nil && val != "" {
				apiKey = val
			}
		}

		// Resolve base URL: use provider's base_url, falling back to proxy
		baseURL := p.BaseURL
		if baseURL == "" {
			baseURL = llm.ProxyURL + "/v1"
		}

		ocProviders[p.Key] = openclawProvider{
			BaseURL: baseURL,
			APIKey:  apiKey,
			API:     p.APIType,
			Models:  ocModels,
		}
	}

	if len(ocProviders) == 0 {
		log.Warn().Msg("openclaw config: no enabled providers with models, using hardcoded fallback")
		return oc.GenerateConfig(token, llm)
	}

	// Determine primary model
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
			Mode:      "merge",
			Providers: ocProviders,
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
			},
			TrustedProxies: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"},
		},
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// WriteConfig generates and writes openclaw.json into the container via Docker SDK.
func (oc *OpenClawClient) WriteConfig(userID, token string) error {
	ctx := context.Background()

	data, err := oc.GenerateConfigFromDB(ctx, token)
	if err != nil {
		return fmt.Errorf("generate openclaw config: %w", err)
	}

	// Write config to host bind-mount directory via SSH (container doesn't exist yet at this point)
	userDir := fmt.Sprintf("%s/%s", oc.dataRoot, userID)
	{
		configDir := userDir + "/.openclaw"

		if _, sshErr := oc.client.RunSSH("mkdir", "-p", configDir); sshErr != nil {
			return fmt.Errorf("mkdir config dir: %w", sshErr)
		}
		if _, sshErr := oc.client.RunSSH("mkdir", "-p", userDir+"/workspace"); sshErr != nil {
			return fmt.Errorf("mkdir workspace dir: %w", sshErr)
		}

		hostConfigPath := configDir + "/openclaw.json"
		escaped := strings.ReplaceAll(string(data), "'", "'\\''")
		writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s", escaped, hostConfigPath)
		if _, sshErr := oc.client.RunSSH("bash", "-c", fmt.Sprintf("'%s'", writeCmd)); sshErr != nil {
			return fmt.Errorf("write config: %w", sshErr)
		}

		if _, sshErr := oc.client.RunSSH("chown", "-R", "1000:1000", userDir); sshErr != nil {
			return fmt.Errorf("chown user dir: %w", sshErr)
		}

		log.Info().Str("user_id", userID).Str("path", hostConfigPath).Msg("openclaw config written to host")
	}
	return nil
}

// SyncConfig writes openclaw.json into a running container via docker copy.
// Uses content-hash comparison to skip writes when config hasn't changed.
// Returns true if config was actually written.
func (oc *OpenClawClient) SyncConfig(ctx context.Context, info *store.ContainerInfo) (bool, error) {
	data, err := oc.GenerateConfigFromDB(ctx, info.ContainerToken)
	if err != nil {
		return false, fmt.Errorf("generate config: %w", err)
	}

	hash := sha256hex(data)

	// Check if the container already has this config applied
	if oc.store != nil {
		botCfg, _ := oc.store.GetBotConfig(ctx, info.UserID, info.ContainerType)
		_ = botCfg // we only need applied_config_hash, checked via direct query
		var appliedHash string
		_ = oc.store.Pool().QueryRow(ctx,
			`SELECT COALESCE(applied_config_hash, '') FROM containers WHERE user_id = $1 AND container_type = $2`,
			info.UserID, info.ContainerType,
		).Scan(&appliedHash)
		if hash == appliedHash && appliedHash != "" {
			return false, nil
		}
	}

	// Write config into the running container
	configPath := "/home/node/.openclaw/openclaw.json"
	if err := oc.client.copyFileToContainer(info.ContainerName, configPath, data); err != nil {
		return false, fmt.Errorf("copy config to container: %w", err)
	}

	// Update applied_config_hash in DB
	if oc.store != nil {
		if err := oc.store.UpdateAppliedConfigHash(ctx, info.UserID, info.ContainerType, hash); err != nil {
			log.Warn().Err(err).Str("user_id", info.UserID).Msg("openclaw sync: update applied hash failed")
		}
	}

	log.Info().Str("container", info.ContainerName).Str("hash", hash[:12]).Msg("openclaw config synced")
	return true, nil
}

// sha256hex computes the hex-encoded SHA-256 hash of data.
func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h)
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

	ctx := context.Background()
	userDir := fmt.Sprintf("%s/%s", oc.dataRoot, userID)

	envVars := oc.ContainerEnvVars()
	envVars["OPENCLAW_GATEWAY_TOKEN"] = token
	var env []string
	for k, v := range envVars {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	port := nat.Port("18789/tcp")
	containerCfg := &container.Config{
		Image: oc.client.image,
		Env:   env,
		Labels: map[string]string{
			"jacoworks.managed": "true",
			"jacoworks.type":    "openclaw",
			"jacoworks.user_id": userID,
		},
		Healthcheck: &container.HealthConfig{
			Test:     []string{"CMD-SHELL", "curl -fsS http://127.0.0.1:18789/healthz || exit 1"},
			Interval: 30 * time.Second,
			Timeout:  5 * time.Second,
			Retries:  3,
		},
	}

	hostCfg := &container.HostConfig{
		RestartPolicy: container.RestartPolicy{Name: "unless-stopped"},
		PortBindings: nat.PortMap{
			port: []nat.PortBinding{
				{HostPort: fmt.Sprintf("%d", hostPort)},
			},
		},
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeBind,
				Source: fmt.Sprintf("%s/.openclaw", userDir),
				Target: "/home/node/.openclaw",
			},
			{
				Type:   mount.TypeBind,
				Source: fmt.Sprintf("%s/workspace", userDir),
				Target: "/data/workspace",
			},
		},
	}

	resp, err := oc.client.cli.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, name)
	if err != nil {
		return "", fmt.Errorf("docker run %s: %w", name, err)
	}

	if err := oc.client.cli.ContainerStart(ctx, resp.ID, types.ContainerStartOptions{}); err != nil {
		return "", fmt.Errorf("docker start %s: %w", name, err)
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
		out, err := oc.client.RunSSH(curlCmd)
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
// After the container is healthy, it syncs config if needed.
func (oc *OpenClawClient) EnsureRunning(ctx context.Context, info *store.ContainerInfo) error {
	status, err := oc.client.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	healthURL := fmt.Sprintf("http://%s:%d/healthz", oc.client.hostIP, info.HostPort)

	var healthErr error
	switch status.Status {
	case "running":
		healthErr = oc.waitForHealthURL(healthURL, 15*time.Second)
	case "paused":
		if err := oc.client.Unpause(info.ContainerName); err != nil {
			return fmt.Errorf("unpause: %w", err)
		}
		healthErr = oc.waitForHealthURL(healthURL, 30*time.Second)
	case "exited":
		if err := oc.client.Start(info.ContainerName); err != nil {
			return fmt.Errorf("start: %w", err)
		}
		time.Sleep(2 * time.Second)
		healthErr = oc.waitForHealthURL(healthURL, 30*time.Second)
	case "not_found":
		log.Info().Str("name", info.ContainerName).Str("user_id", info.UserID).Msg("openclaw container not found, reprovisioning")
		if _, err := oc.Provision(info.ContainerName, info.UserID, info.ContainerToken, info.HostPort); err != nil {
			return fmt.Errorf("reprovision %s: %w", info.ContainerName, err)
		}
		return nil
	default:
		return fmt.Errorf("container %s in unexpected state: %s", info.ContainerName, status.Status)
	}

	if healthErr != nil {
		return healthErr
	}

	// Sync config after container is running and healthy
	if changed, err := oc.SyncConfig(ctx, info); err != nil {
		log.Warn().Err(err).Str("name", info.ContainerName).Msg("config sync failed after ensure running")
	} else if changed {
		log.Info().Str("name", info.ContainerName).Msg("config synced on ensure running")
	}

	return nil
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
