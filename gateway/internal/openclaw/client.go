// Package openclaw provides backend-neutral OpenClaw container orchestration.
// It depends on container.Runtime for backend-neutral instance management.
package openclaw

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
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

// HostIP returns the host IP used for upstream connections and health checks.
func (c *Client) HostIP() string {
	return c.hostIP
}

const defaultGatewayPort = 18789

const (
	skillsHashPath        = "/home/node/.openclaw/skills/.bundle-hash"
	searchCredentialsPath = "/home/node/.openclaw/credentials/search.json"
	larkCredentialsPath   = "/home/node/.openclaw/credentials/lark.json"
	assetAuthPath         = "/home/node/.config/asset-gateway/auth.json"
	skillEnvDropInPath    = "/etc/systemd/system/openclaw.service.d/skills.conf"
)

type skillBundleFile struct {
	RelPath string
	Data    []byte
}

type skillBundle struct {
	Files             []skillBundleFile
	SearchCredentials []byte
	LarkCredentials   []byte
	AssetGatewayAuth  []byte
	SystemdDropIn     []byte
	Hash              string
}

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
	set("GROK_API_URL", llm.GrokAPIURL)
	set("GROK_API_KEY", llm.GrokAPIKey)
	set("GROK_MODEL", llm.GrokModel)
	set("FAL_API_KEY", llm.FalAPIKey)
	set("MINERU_TOKEN", llm.MineruToken)
	set("JIMENG_API_URL", llm.JimengAPIURL)
	set("JIMENG_API_KEY", llm.JimengAPIKey)
	set("ASSET_GATEWAY_TOKEN", llm.AssetGatewayToken)
	set("ASSET_GATEWAY_URL", llm.AssetGatewayURL)
	set("EMBEDDING_BASE_URL", llm.EmbeddingBaseURL)
	set("EMBEDDING_API_KEY", llm.EmbeddingAPIKey)
	set("LARK_APP_ID", llm.FeishuAppID)
	set("LARK_APP_SECRET", llm.FeishuAppSecret)

	return envs
}

// Provision creates and starts a new OpenClaw VM for a user.
// Returns the VM's bridge IP address (e.g. 10.193.112.x).
func (c *Client) Provision(name, userID, token string, hostPort, vncPort int) (string, error) {
	log.Info().Str("name", name).Str("user_id", userID).Msg("provisioning openclaw VM")

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
		ContainerPort: defaultGatewayPort,
		MemoryMB:      4096, // 4 GiB for XFCE + OpenClaw + VNC
		CPUs:          4,
	}

	// 1. Create and start VM (waits for VM agent to be ready)
	if err := c.rt.Create(ctx, spec); err != nil {
		return "", fmt.Errorf("create instance %s: %w", name, err)
	}

	// 2. Get VM's bridge IP
	vmIP, err := c.waitForVMIP(ctx, name, 60*time.Second)
	if err != nil {
		return "", fmt.Errorf("get VM IP for %s: %w", name, err)
	}
	log.Info().Str("name", name).Str("vm_ip", vmIP).Msg("VM bridge IP acquired")

	// 3. Write config into running VM
	if err := c.WriteConfig(name, userID, token, defaultGatewayPort); err != nil {
		return "", fmt.Errorf("write config: %w", err)
	}

	// 4. Restart so OpenClaw picks up the config
	if err := c.rt.Restart(ctx, name); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("openclaw provision: restart after config write failed")
	}

	// 5. Wait for VM agent again after restart, then health check on VM's bridge IP
	time.Sleep(5 * time.Second)
	healthURL := fmt.Sprintf("http://%s:%d/healthz", vmIP, defaultGatewayPort)
	if err := httpHealthPoll(healthURL, 90*time.Second); err != nil {
		log.Warn().Err(err).Str("name", name).Str("url", healthURL).Msg("openclaw VM started but health check failed")
	}

	// 6. Write JMOS config and start service
	if _, err := c.SyncJMOSConfig(name, userID, token); err != nil {
		log.Warn().Err(err).Str("container", name).Msg("jmos config write failed during provision")
	} else {
		if err := c.StartJMOS(name); err != nil {
			log.Warn().Err(err).Str("container", name).Msg("jmos start failed during provision")
		}
	}

	log.Info().Str("name", name).Str("vm_ip", vmIP).Msg("openclaw VM provisioned")
	return vmIP, nil
}

// waitForVMIP polls until the VM has a bridge IP assigned.
func (c *Client) waitForVMIP(ctx context.Context, name string, timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		info, err := c.rt.Status(ctx, name)
		if err != nil {
			return "", err
		}
		if info.IP != "" {
			return info.IP, nil
		}
		time.Sleep(3 * time.Second)
	}
	return "", fmt.Errorf("VM %s did not get an IP within %s", name, timeout)
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

	// 2. Deploy repo-managed skills, credentials, and env drop-ins.
	if hash, err := c.DeploySkills(ctx, containerName); err != nil {
		log.Warn().Err(err).Str("container", containerName).Msg("openclaw: deploy skills failed")
	} else if hash != "" {
		log.Info().Str("container", containerName).Str("hash", hash[:12]).Msg("openclaw: skills deployed")
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
		"/data/workspace/jamoss/data", "/data/workspace/jamoss/logs",
		"/data/workspace/_attachments")

	// 6. Write workspace AGENTS.md (injected into every conversation by OpenClaw)
	c.rt.WriteFile(ctx, containerName, "/data/workspace/AGENTS.md", []byte(workspaceAgentsMD))

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

	// Also ensure workspace AGENTS.md is up to date
	c.rt.Exec(ctx, info.ContainerName, "mkdir", "-p", "/data/workspace/_attachments")
	c.rt.WriteFile(ctx, info.ContainerName, "/data/workspace/AGENTS.md", []byte(workspaceAgentsMD))

	log.Info().Str("container", info.ContainerName).Str("hash", hash[:12]).Msg("openclaw config synced")
	return true, nil
}

// EnsureRunning checks the VM status and brings it to a running state.
// After the VM is healthy, it syncs config if needed.
func (c *Client) EnsureRunning(ctx context.Context, info *store.ContainerInfo) error {
	status, err := c.rt.Status(ctx, info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	// Use VM's actual bridge IP for health checks (port is always defaultGatewayPort inside the VM)
	vmIP := c.resolveHost(info.ContainerIP)
	if status.IP != "" {
		vmIP = status.IP
	}
	healthURL := fmt.Sprintf("http://%s:%d/healthz", vmIP, defaultGatewayPort)

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
		if _, err := c.Provision(info.ContainerName, info.UserID, info.ContainerToken, info.HostPort, info.VncPort); err != nil {
			return fmt.Errorf("reprovision %s: %w", info.ContainerName, err)
		}
		return nil
	default:
		return fmt.Errorf("container %s in unexpected state: %s", info.ContainerName, status.Status)
	}

	if healthErr != nil {
		return healthErr
	}

	// Sync config in background — don't block the WS connection chain.
	// Config is already persisted in the VM from last sync; this only
	// applies incremental changes (model list, JMOS settings).
	go func() {
		bgCtx := context.Background()
		if changed, err := c.SyncConfig(bgCtx, info); err != nil {
			log.Warn().Err(err).Str("name", info.ContainerName).Msg("config sync failed after ensure running")
		} else if changed {
			log.Info().Str("name", info.ContainerName).Msg("config synced on ensure running")
		}

		if err := c.DeploySkillsIfChanged(bgCtx, info); err != nil {
			log.Warn().Err(err).Str("name", info.ContainerName).Msg("skills sync failed after ensure running")
		}

		if changed, err := c.SyncJMOSConfig(info.ContainerName, info.UserID, info.ContainerToken); err != nil {
			log.Warn().Err(err).Str("name", info.ContainerName).Msg("jmos config sync failed after ensure running")
		} else if changed {
			if err := c.RestartJMOS(info.ContainerName); err != nil {
				log.Warn().Err(err).Str("name", info.ContainerName).Msg("jmos restart failed after config sync")
			}
		}

		c.EnsureJMOSRunning(info.ContainerName)
	}()

	return nil
}

// UpstreamAddr returns the WebSocket upstream address for an OpenClaw VM.
// Uses the VM's bridge IP and the fixed OpenClaw gateway port (18789).
func (c *Client) UpstreamAddr(info *store.ContainerInfo) string {
	host := c.resolveHost(info.ContainerIP)
	return fmt.Sprintf("ws://%s:%d", host, defaultGatewayPort)
}

// resolveHost returns containerIP if non-empty, otherwise falls back to c.hostIP.
func (c *Client) resolveHost(containerIP string) string {
	if containerIP != "" {
		return containerIP
	}
	return c.hostIP
}

// sha256hex computes the hex-encoded SHA-256 hash of data.
func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h)
}

// DeploySkills copies repo-managed base skills and related auth files into a VM.
// It only writes files; callers that sync a running VM should restart OpenClaw separately.
func (c *Client) DeploySkills(ctx context.Context, containerName string) (string, error) {
	bundle, err := c.loadSkillsBundle()
	if err != nil {
		return "", err
	}
	if err := c.writeSkillBundle(ctx, containerName, bundle); err != nil {
		return "", err
	}
	return bundle.Hash, nil
}

// DeploySkillsIfChanged syncs the repo-managed skill bundle into a running VM when the
// persisted bundle hash differs, then restarts OpenClaw so the runtime reloads the bundle.
func (c *Client) DeploySkillsIfChanged(ctx context.Context, info *store.ContainerInfo) error {
	bundle, err := c.loadSkillsBundle()
	if err != nil {
		return err
	}
	currentHash, err := c.rt.ReadFile(ctx, info.ContainerName, skillsHashPath)
	if err == nil && strings.TrimSpace(currentHash) == bundle.Hash {
		return nil
	}
	if err := c.writeSkillBundle(ctx, info.ContainerName, bundle); err != nil {
		return err
	}
	if _, err := c.rt.Exec(ctx, info.ContainerName, "systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("reload systemd after skills sync: %w", err)
	}
	if _, err := c.rt.Exec(ctx, info.ContainerName, "systemctl", "restart", "openclaw"); err != nil {
		return fmt.Errorf("restart openclaw after skills sync: %w", err)
	}
	if err := c.waitForContainerHealthURL(info.ContainerName, "http://127.0.0.1:18789/healthz", 45*time.Second); err != nil {
		return err
	}
	log.Info().Str("container", info.ContainerName).Str("hash", bundle.Hash[:12]).Msg("openclaw skills synced")
	return nil
}

// SyncAllVMs pushes the current skill bundle to every running OpenClaw VM.
func (c *Client) SyncAllVMs(ctx context.Context) error {
	if c.store == nil {
		return nil
	}
	containers, err := c.store.ListContainersByType(ctx, store.ContainerTypeOpenClaw)
	if err != nil {
		return fmt.Errorf("list openclaw VMs: %w", err)
	}
	var failed []string
	for _, info := range containers {
		if info == nil || strings.TrimSpace(info.ContainerName) == "" {
			continue
		}
		status, err := c.rt.Status(ctx, info.ContainerName)
		if err != nil {
			failed = append(failed, fmt.Sprintf("%s(status: %v)", info.ContainerName, err))
			continue
		}
		if status.Status != "running" {
			continue
		}
		if err := c.DeploySkillsIfChanged(ctx, info); err != nil {
			failed = append(failed, fmt.Sprintf("%s(sync: %v)", info.ContainerName, err))
		}
	}
	if len(failed) > 0 {
		return fmt.Errorf("sync openclaw skills: %s", strings.Join(failed, "; "))
	}
	return nil
}

func (c *Client) writeSkillBundle(ctx context.Context, containerName string, bundle *skillBundle) error {
	dirs := []string{
		"/home/node/.openclaw/skills",
		"/home/node/.openclaw/credentials",
		"/etc/systemd/system/openclaw.service.d",
	}
	if len(bundle.AssetGatewayAuth) > 0 {
		dirs = append(dirs, "/home/node/.config/asset-gateway")
	}
	seenDirs := map[string]struct{}{}
	for _, file := range bundle.Files {
		dirs = append(dirs, path.Dir(path.Join("/home/node/.openclaw/skills", file.RelPath)))
	}
	filtered := make([]string, 0, len(dirs))
	for _, dir := range dirs {
		dir = path.Clean(dir)
		if _, ok := seenDirs[dir]; ok {
			continue
		}
		seenDirs[dir] = struct{}{}
		filtered = append(filtered, dir)
	}
	sort.Strings(filtered)
	args := append([]string{"mkdir", "-p"}, filtered...)
	if _, err := c.rt.Exec(ctx, containerName, args...); err != nil {
		return fmt.Errorf("prepare skill directories: %w", err)
	}

	for _, file := range bundle.Files {
		target := path.Join("/home/node/.openclaw/skills", file.RelPath)
		if err := c.rt.WriteFile(ctx, containerName, target, file.Data); err != nil {
			return fmt.Errorf("write skill %s: %w", file.RelPath, err)
		}
	}
	if len(bundle.SearchCredentials) > 0 {
		if err := c.rt.WriteFile(ctx, containerName, searchCredentialsPath, bundle.SearchCredentials); err != nil {
			return fmt.Errorf("write search credentials: %w", err)
		}
	}
	if len(bundle.LarkCredentials) > 0 {
		if err := c.rt.WriteFile(ctx, containerName, larkCredentialsPath, bundle.LarkCredentials); err != nil {
			return fmt.Errorf("write lark credentials: %w", err)
		}
	}
	if len(bundle.AssetGatewayAuth) > 0 {
		if err := c.rt.WriteFile(ctx, containerName, assetAuthPath, bundle.AssetGatewayAuth); err != nil {
			return fmt.Errorf("write asset gateway auth: %w", err)
		}
	}
	if len(bundle.SystemdDropIn) > 0 {
		if err := c.rt.WriteFile(ctx, containerName, skillEnvDropInPath, bundle.SystemdDropIn); err != nil {
			return fmt.Errorf("write skills env drop-in: %w", err)
		}
	}
	if err := c.rt.WriteFile(ctx, containerName, skillsHashPath, []byte(bundle.Hash+"\n")); err != nil {
		return fmt.Errorf("write skills hash marker: %w", err)
	}
	if _, err := c.rt.Exec(ctx, containerName, "sh", "-lc", "chown -R 1000:1000 /home/node/.openclaw && if [ -d /home/node/.config ]; then chown -R 1000:1000 /home/node/.config; fi"); err != nil {
		return fmt.Errorf("fix skills ownership: %w", err)
	}
	return nil
}

func (c *Client) loadSkillsBundle() (*skillBundle, error) {
	skillsDir, err := c.resolveSkillsDir()
	if err != nil {
		return nil, err
	}
	bundle := &skillBundle{}
	err = filepath.WalkDir(skillsDir, func(filePath string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		name := d.Name()
		if strings.HasPrefix(name, ".") {
			if d.IsDir() && filePath != skillsDir {
				return filepath.SkipDir
			}
			if !d.IsDir() {
				return nil
			}
		}
		if d.IsDir() {
			return nil
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(skillsDir, filePath)
		if err != nil {
			return err
		}
		bundle.Files = append(bundle.Files, skillBundleFile{
			RelPath: filepath.ToSlash(relPath),
			Data:    data,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load skills bundle: %w", err)
	}
	sort.Slice(bundle.Files, func(i, j int) bool {
		return bundle.Files[i].RelPath < bundle.Files[j].RelPath
	})
	llm := c.getLLM()
	bundle.SearchCredentials = buildSearchCredentials(llm)
	bundle.LarkCredentials = buildLarkCredentials(llm)
	bundle.AssetGatewayAuth = buildAssetGatewayAuth(llm)
	bundle.SystemdDropIn = buildSkillEnvDropIn(llm)
	bundle.Hash = computeSkillBundleHash(bundle)
	return bundle, nil
}

func (c *Client) resolveSkillsDir() (string, error) {
	var candidates []string
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, "openclaw", "skills"),
			filepath.Join(exeDir, "..", "openclaw", "skills"),
		)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "openclaw", "skills"),
			filepath.Join(wd, "..", "openclaw", "skills"),
		)
	}
	candidates = append(candidates,
		filepath.Join("openclaw", "skills"),
		filepath.Join("..", "openclaw", "skills"),
	)
	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		candidate = filepath.Clean(candidate)
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		if stat, err := os.Stat(candidate); err == nil && stat.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("openclaw skills directory not found")
}

func buildSearchCredentials(llm config.LLMConfig) []byte {
	payload := map[string]any{}
	if llm.ExaAPIKey != "" {
		payload["exa"] = llm.ExaAPIKey
	}
	if llm.TavilyKey != "" {
		payload["tavily"] = llm.TavilyKey
	}
	if llm.GrokAPIURL != "" || llm.GrokAPIKey != "" || llm.GrokModel != "" {
		model := llm.GrokModel
		if model == "" {
			model = "grok-4.1-fast"
		}
		payload["grok"] = map[string]string{
			"apiUrl": llm.GrokAPIURL,
			"apiKey": llm.GrokAPIKey,
			"model":  model,
		}
	}
	if len(payload) == 0 {
		return nil
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil
	}
	return append(data, '\n')
}

func buildLarkCredentials(llm config.LLMConfig) []byte {
	if llm.FeishuAppID == "" && llm.FeishuAppSecret == "" {
		return nil
	}
	payload := map[string]string{}
	if llm.FeishuAppID != "" {
		payload["app_id"] = llm.FeishuAppID
	}
	if llm.FeishuAppSecret != "" {
		payload["app_secret"] = llm.FeishuAppSecret
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil
	}
	return append(data, '\n')
}

func buildAssetGatewayAuth(llm config.LLMConfig) []byte {
	payload := map[string]string{}
	if llm.AssetGatewayToken != "" {
		payload["token"] = llm.AssetGatewayToken
	}
	if llm.AssetGatewayURL != "" {
		payload["gateway_url"] = llm.AssetGatewayURL
	}
	if len(payload) == 0 {
		return nil
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil
	}
	return append(data, '\n')
}

func buildSkillEnvDropIn(llm config.LLMConfig) []byte {
	entries := [][2]string{
		{"EXA_API_KEY", llm.ExaAPIKey},
		{"TAVILY_API_KEY", llm.TavilyKey},
		{"GROK_API_KEY", llm.GrokAPIKey},
		{"GROK_API_URL", llm.GrokAPIURL},
		{"GROK_MODEL", llm.GrokModel},
		{"ASSET_GATEWAY_TOKEN", llm.AssetGatewayToken},
		{"ASSET_GATEWAY_URL", llm.AssetGatewayURL},
		{"LARK_APP_ID", llm.FeishuAppID},
		{"LARK_APP_SECRET", llm.FeishuAppSecret},
	}
	var lines []string
	for _, entry := range entries {
		if strings.TrimSpace(entry[1]) == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf("Environment=%s=%s", entry[0], escapeSystemdEnv(entry[1])))
	}
	if len(lines) == 0 {
		return nil
	}
	content := "[Service]\n" + strings.Join(lines, "\n") + "\n"
	return []byte(content)
}

func computeSkillBundleHash(bundle *skillBundle) string {
	h := sha256.New()
	for _, file := range bundle.Files {
		_, _ = h.Write([]byte(file.RelPath))
		_, _ = h.Write([]byte{0})
		_, _ = h.Write(file.Data)
		_, _ = h.Write([]byte{0})
	}
	for _, extra := range []struct {
		name string
		data []byte
	}{
		{name: searchCredentialsPath, data: bundle.SearchCredentials},
		{name: larkCredentialsPath, data: bundle.LarkCredentials},
		{name: assetAuthPath, data: bundle.AssetGatewayAuth},
		{name: skillEnvDropInPath, data: bundle.SystemdDropIn},
	} {
		if len(extra.data) == 0 {
			continue
		}
		_, _ = h.Write([]byte(extra.name))
		_, _ = h.Write([]byte{0})
		_, _ = h.Write(extra.data)
		_, _ = h.Write([]byte{0})
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}

func escapeSystemdEnv(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	return strings.ReplaceAll(value, `"`, `\"`)
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

// workspaceAgentsMD is the bootstrap AGENTS.md written to /data/workspace/.
// OpenClaw ContextEngine automatically injects workspace AGENTS.md into every
// conversation turn, so the agent always knows about file handling conventions.
const workspaceAgentsMD = `# 工作区操作指引

## 文件交互

用户通过 Web 聊天界面（chat.jingao.club）与你对话。界面支持文件上传和下载。

### 读取用户上传的文件

用户上传的文件自动保存到 /data/workspace/_attachments/ 目录。
当消息中出现 [已上传附件] 标记时，后面会列出文件的 VM 内路径：

    [已上传附件]
    - report.pdf: /data/workspace/_attachments/fa_xxx-report.pdf

直接用 read 或 exec 工具读取这些路径。对于二进制文件（图片、PDF 等），
用 exec 配合对应工具处理（如 python、pdftotext、file 等）。

### 生成文件供用户下载

当你用 write 或 exec 工具创建文件时，**在回复中提及文件的完整绝对路径**。
系统会自动检测路径并在界面中展示下载卡片。

支持自动检测的扩展名：
docx doc xlsx xls pptx pdf csv png jpg jpeg gif svg webp
mp4 mov webm mp3 wav m4a ogg flac zip tar gz html md

示例：
- write 工具写入 /data/workspace/output/report.docx → 自动展示下载卡片
- exec 运行 python 脚本生成 /data/workspace/chart.png → 在回复中写明路径即可

### 工作区目录结构

- 你的默认工作目录是当前 workspace（通常是 ~/.openclaw/workspace-default/）
- /data/workspace/_attachments/ — 用户上传文件存放处
- /data/workspace/memory/ — 记忆日志（如启用）

重要：当你用 write 工具创建文件时，建议使用绝对路径（如 /data/workspace/report.docx），
这样系统能更可靠地检测文件并展示下载卡片。如果使用相对路径，系统也会尝试定位文件。
`
