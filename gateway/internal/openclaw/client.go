// Package openclaw provides backend-neutral OpenClaw container orchestration.
// It depends on container.Runtime instead of the Docker SDK.
package openclaw

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/container"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
)

var (
	ErrTemplatesDirNotFound = errors.New("openclaw templates directory not found")
	ErrTemplateNotFound     = errors.New("openclaw template not found")
)

// Client orchestrates OpenClaw containers via a backend-neutral Runtime.
type Client struct {
	rt       container.Runtime
	dataRoot string // host-side data root (e.g. /srv/jacoworks/openclaw)
	hostIP   string // IP for health checks and upstream (e.g. 127.0.0.1)
	image    string // OCI image ref (e.g. ghcr.io/openclaw/openclaw:latest)
	getLLM   func() config.LLMConfig
	store    *store.Store
}

// NewClient creates a new OpenClaw orchestration client.
func NewClient(rt container.Runtime, dataRoot, hostIP, image string, getLLM func() config.LLMConfig, s *store.Store) *Client {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}
	if image == "" {
		image = "ghcr.io/openclaw/openclaw:latest"
	}
	return &Client{rt: rt, dataRoot: dataRoot, hostIP: hostIP, image: image, getLLM: getLLM, store: s}
}

// Runtime returns the underlying container runtime.
func (c *Client) Runtime() container.Runtime {
	return c.rt
}

const defaultGatewayPort = 18789

// resolveGatewayPort returns the gateway port, falling back to the default.
func (c *Client) resolveGatewayPort(hostPort int) int {
	if hostPort > 0 {
		return hostPort
	}
	return defaultGatewayPort
}

// ContainerEnvVars builds the environment variables map for an OpenClaw container.
func (c *Client) ContainerEnvVars() map[string]string {
	llm := c.getLLM()
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
	set("MINERU_TOKEN", llm.MineruToken)
	set("JIMENG_API_URL", llm.JimengAPIURL)
	set("JIMENG_API_KEY", llm.JimengAPIKey)
	set("EMBEDDING_BASE_URL", llm.EmbeddingBaseURL)
	set("EMBEDDING_API_KEY", llm.EmbeddingAPIKey)

	return envs
}

// Provision creates and starts a new OpenClaw container for a user.
func (c *Client) Provision(name, userID, token string, hostPort int) (string, error) {
	log.Info().Str("name", name).Str("user_id", userID).Int("host_port", hostPort).Msg("provisioning openclaw container")

	ctx := context.Background()
	userDir := fmt.Sprintf("%s/%s", c.dataRoot, userID)

	// Ensure host directories exist for bind mounts
	for _, sub := range []string{".openclaw", "workspace"} {
		if err := os.MkdirAll(fmt.Sprintf("%s/%s", userDir, sub), 0755); err != nil {
			return "", fmt.Errorf("mkdir %s/%s: %w", userDir, sub, err)
		}
	}

	envVars := c.ContainerEnvVars()
	envVars["OPENCLAW_GATEWAY_TOKEN"] = token
	envVars["HOME"] = "/home/node"

	gatewayPort := c.resolveGatewayPort(hostPort)

	spec := container.InstanceSpec{
		Name:  name,
		Image: c.image,
		User:  "root",
		Env:   envVars,
		Labels: map[string]string{
			"jacoworks.managed": "true",
			"jacoworks.type":    "openclaw",
			"jacoworks.user_id": userID,
		},
		BindMounts: []container.BindMount{
			{Source: fmt.Sprintf("%s/.openclaw", userDir), Target: "/home/node/.openclaw"},
			{Source: fmt.Sprintf("%s/workspace", userDir), Target: "/data/workspace"},
		},
		HostPort:      hostPort,
		ContainerPort: defaultGatewayPort,
		HealthCmd:     fmt.Sprintf("curl -fsS http://127.0.0.1:%d/healthz || exit 1", gatewayPort),
	}

	// 1. Create and start instance
	if err := c.rt.Create(ctx, spec); err != nil {
		return "", fmt.Errorf("create instance %s: %w", name, err)
	}

	// 2. Write config into running instance
	if err := c.WriteConfig(name, userID, token, gatewayPort); err != nil {
		return "", fmt.Errorf("write config: %w", err)
	}

	// 3. Restart so OpenClaw picks up the config
	if err := c.rt.Restart(ctx, name); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("openclaw provision: restart after config write failed")
	}

	// 4. Wait for health
	time.Sleep(3 * time.Second)
	healthURL := fmt.Sprintf("http://%s:%d/healthz", c.hostIP, hostPort)
	if err := httpHealthPoll(healthURL, 60*time.Second); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("openclaw container started but health check failed")
	}

	// 5. Write JMOS config and start service
	if err := c.WriteJMOSConfig(name, userID, token); err != nil {
		log.Warn().Err(err).Str("container", name).Msg("jmos config write failed during provision")
	} else {
		if err := c.StartJMOS(name); err != nil {
			log.Warn().Err(err).Str("container", name).Msg("jmos start failed during provision")
		}
	}

	log.Info().Str("name", name).Str("host_ip", c.hostIP).Int("host_port", hostPort).Msg("openclaw container provisioned")
	return c.hostIP, nil
}

// WriteConfig generates and writes openclaw.json into a running container.
func (c *Client) WriteConfig(containerName, userID, token string, hostPort int) error {
	ctx := context.Background()

	data, err := c.GenerateConfigFromDB(ctx, userID, token, hostPort)
	if err != nil {
		return fmt.Errorf("generate openclaw config: %w", err)
	}

	// 1. Write openclaw.json
	configPath := "/home/node/.openclaw/openclaw.json"
	if err := c.rt.WriteFile(ctx, containerName, configPath, data); err != nil {
		return fmt.Errorf("copy config: %w", err)
	}

	// 2. Write team-builder SKILL.md
	if skillData, err := c.loadTeamBuilderSkill(); err == nil {
		skillPath := "/home/node/.openclaw/skills/team-builder/SKILL.md"
		if err := c.rt.WriteFile(ctx, containerName, skillPath, skillData); err != nil {
			log.Warn().Err(err).Msg("openclaw: write team-builder skill failed")
		}
	} else {
		log.Warn().Err(err).Msg("openclaw: load team-builder skill failed")
	}

	// 3. Deploy profile files (prompts + skills for each agent profile)
	if n, err := c.DeployProfiles(containerName); err != nil {
		log.Warn().Err(err).Str("container", containerName).Msg("openclaw: deploy profiles failed")
	} else if n > 0 {
		log.Info().Int("files", n).Str("container", containerName).Msg("openclaw: profiles deployed")
	}

	// 4. Fix ownership of bind-mounted directories so OpenClaw (node user, uid 1000) can write.
	c.rt.Exec(ctx, containerName, "chown", "-R", "1000:1000", "/home/node/.openclaw", "/data/workspace")

	// 5. Create workspace directories
	c.rt.Exec(ctx, containerName, "mkdir", "-p",
		"/data/workspace/jamoss/data", "/data/workspace/jamoss/logs")

	log.Info().Str("user_id", userID).Str("container", containerName).Msg("openclaw config written to container")
	return nil
}

// SyncConfig writes openclaw.json into a running container.
// Uses content-hash comparison to skip writes when config hasn't changed.
// Returns true if config was actually written.
func (c *Client) SyncConfig(ctx context.Context, info *store.ContainerInfo) (bool, error) {
	data, err := c.GenerateConfigFromDB(ctx, info.UserID, info.ContainerToken, info.HostPort)
	if err != nil {
		return false, fmt.Errorf("generate config: %w", err)
	}

	hash := sha256hex(data)

	// Check if the container already has this config applied
	if c.store != nil {
		var appliedHash string
		_ = c.store.Pool().QueryRow(ctx,
			`SELECT COALESCE(applied_config_hash, '') FROM containers WHERE user_id = $1 AND container_type = $2`,
			info.UserID, info.ContainerType,
		).Scan(&appliedHash)
		if hash == appliedHash && appliedHash != "" {
			return false, nil
		}
	}

	// Write config into the running container
	configPath := "/home/node/.openclaw/openclaw.json"
	if err := c.rt.WriteFile(ctx, info.ContainerName, configPath, data); err != nil {
		return false, fmt.Errorf("copy config to container: %w", err)
	}

	// Update applied_config_hash in DB
	if c.store != nil {
		if err := c.store.UpdateAppliedConfigHash(ctx, info.UserID, info.ContainerType, hash); err != nil {
			log.Warn().Err(err).Str("user_id", info.UserID).Msg("openclaw sync: update applied hash failed")
		}
	}

	log.Info().Str("container", info.ContainerName).Str("hash", hash[:12]).Msg("openclaw config synced")
	return true, nil
}

// EnsureRunning checks the container status and brings it to a running state.
// After the container is healthy, it syncs config if needed.
func (c *Client) EnsureRunning(ctx context.Context, info *store.ContainerInfo) error {
	status, err := c.rt.Status(ctx, info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	healthURL := fmt.Sprintf("http://%s:%d/healthz", c.hostIP, info.HostPort)

	var healthErr error
	switch status.Status {
	case "running":
		healthErr = httpHealthPoll(healthURL, 15*time.Second)
	case "paused":
		if err := c.rt.Unpause(ctx, info.ContainerName); err != nil {
			return fmt.Errorf("unpause: %w", err)
		}
		healthErr = httpHealthPoll(healthURL, 30*time.Second)
	case "exited", "stopped":
		if err := c.rt.Start(ctx, info.ContainerName); err != nil {
			return fmt.Errorf("start: %w", err)
		}
		time.Sleep(2 * time.Second)
		healthErr = httpHealthPoll(healthURL, 30*time.Second)
	case "not_found":
		log.Info().Str("name", info.ContainerName).Str("user_id", info.UserID).Msg("openclaw container not found, reprovisioning")
		if _, err := c.Provision(info.ContainerName, info.UserID, info.ContainerToken, info.HostPort); err != nil {
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
	if changed, err := c.SyncConfig(ctx, info); err != nil {
		log.Warn().Err(err).Str("name", info.ContainerName).Msg("config sync failed after ensure running")
	} else if changed {
		log.Info().Str("name", info.ContainerName).Msg("config synced on ensure running")
	}

	// Ensure JMOS is running (binary is pre-installed in golden image)
	c.EnsureJMOSRunning(info.ContainerName)

	return nil
}

// UpstreamAddr returns the WebSocket upstream address for an OpenClaw container.
func (c *Client) UpstreamAddr(info *store.ContainerInfo) string {
	host := c.hostIP
	if info.ContainerIP != "" {
		host = info.ContainerIP
	}
	port := info.HostPort
	if port == 0 {
		port = defaultGatewayPort
	}
	return fmt.Sprintf("ws://%s:%d", host, port)
}

// sha256hex computes the hex-encoded SHA-256 hash of data.
func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h)
}

// httpHealthPoll polls a URL until HTTP 200 or timeout.
func httpHealthPoll(url string, timeout time.Duration) error {
	client := &http.Client{Timeout: 5 * time.Second}
	deadline := time.Now().Add(timeout)

	log.Debug().Str("url", url).Dur("timeout", timeout).Msg("waiting for health")

	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				log.Info().Str("url", url).Msg("health check passed")
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("health check %s not ready after %s", url, timeout)
}

// execChecked runs a shell script inside a container and verifies it succeeded
// by checking for a sentinel string in the output.
func (c *Client) execChecked(containerName, script string) error {
	const sentinel = "__JACOWORKS_EXEC_OK__"
	ctx := context.Background()
	result, err := c.rt.Exec(ctx, containerName, "sh", "-lc", fmt.Sprintf("set -eu\n%s\nprintf %s", strings.TrimSpace(script), sentinel))
	if err != nil {
		return err
	}
	if !strings.Contains(result.Stdout, sentinel) {
		return fmt.Errorf("exec failed: %s", strings.TrimSpace(result.Stdout))
	}
	return nil
}

// waitForContainerHealthURL polls a health URL from inside the container via exec curl.
func (c *Client) waitForContainerHealthURL(containerName, url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 --max-time 5 %s || true", url)
	ctx := context.Background()

	for time.Now().Before(deadline) {
		result, err := c.rt.Exec(ctx, containerName, "sh", "-lc", curlCmd)
		if err == nil {
			code := strings.TrimSpace(strings.Trim(result.Stdout, "'"))
			if code == "200" {
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}

	return fmt.Errorf("container %s endpoint %s not healthy after %s", containerName, url, timeout)
}

// loadTeamBuilderSkill reads the team-builder SKILL.md from the openclaw/skills directory.
func (c *Client) loadTeamBuilderSkill() ([]byte, error) {
	candidates := []string{
		"openclaw/skills/team-builder/SKILL.md",
		"../openclaw/skills/team-builder/SKILL.md",
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			wd+"/openclaw/skills/team-builder/SKILL.md",
			wd+"/../openclaw/skills/team-builder/SKILL.md",
		)
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := exePath[:strings.LastIndex(exePath, "/")]
		candidates = append(candidates,
			exeDir+"/openclaw/skills/team-builder/SKILL.md",
			exeDir+"/../openclaw/skills/team-builder/SKILL.md",
		)
	}
	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err == nil {
			return data, nil
		}
	}
	return nil, fmt.Errorf("team-builder SKILL.md not found")
}
