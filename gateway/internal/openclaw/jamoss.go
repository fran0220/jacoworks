package openclaw

import (
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
	"gopkg.in/yaml.v3"
)

const (
	jmosBinaryPath       = "/usr/local/bin/jmos"
	jmosConfigPath       = "/etc/jmos/config.yaml"
	jmosHealthEndpoint   = "http://127.0.0.1:6565/api/health"
	jmosServiceName      = "jmos.service"
	defaultJMOSDBPath    = "/data/workspace/jamoss/data/tasks.db"
	defaultJMOSWorkspace = "/data/workspace/jamoss"
)

type jmosConfigFile struct {
	Project      jmosProjectConfig      `yaml:"project"`
	Admin        jmosAdminConfig        `yaml:"admin"`
	Agent        jmosAgentConfig        `yaml:"agent"`
	Notification jmosNotificationConfig `yaml:"notification"`
	Server       jmosServerConfig       `yaml:"server"`
	Database     jmosDatabaseConfig     `yaml:"database"`
	Workspace    jmosWorkspaceConfig    `yaml:"workspace"`
	WebUI        jmosWebUIConfig        `yaml:"webui"`
}

type jmosProjectConfig struct {
	Name string `yaml:"name"`
}

type jmosAdminConfig struct {
	Password string `yaml:"password"`
}

type jmosAgentConfig struct {
	RegistrationToken string `yaml:"registration_token"`
	AllowRegistration bool   `yaml:"allow_registration"`
}

type jmosNotificationConfig struct {
	Enabled  bool     `yaml:"enabled"`
	Channels []string `yaml:"channels"`
	Events   []string `yaml:"events"`
}

type jmosServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

type jmosDatabaseConfig struct {
	Type string `yaml:"type"`
	Path string `yaml:"path"`
}

type jmosWorkspaceConfig struct {
	Root string `yaml:"root"`
}

type jmosWebUIConfig struct {
	PublicFeed        bool `yaml:"public_feed"`
	FeedRetentionDays int  `yaml:"feed_retention_days"`
}

// WriteJMOSConfig renders and writes JMOS config.yaml into the container.
// The JMOS binary and systemd service are pre-installed in the golden image.
func (c *Client) WriteJMOSConfig(containerName, userID, token string) error {
	_, err := c.SyncJMOSConfig(containerName, userID, token)
	return err
}

// SyncJMOSConfig writes the desired config if it differs from the current one.
// Returns true when the file was updated.
func (c *Client) SyncJMOSConfig(containerName, userID, token string) (bool, error) {
	configTemplate, err := c.loadJMOSConfigTemplate()
	if err != nil {
		return false, fmt.Errorf("load jmos config template: %w", err)
	}

	configYAML, err := c.renderJMOSConfig(configTemplate, userID, token)
	if err != nil {
		return false, fmt.Errorf("render jmos config: %w", err)
	}
	ctx := context.Background()

	currentConfig, err := c.rt.ReadFile(ctx, containerName, jmosConfigPath)
	if err == nil && strings.TrimSpace(currentConfig) == strings.TrimSpace(string(configYAML)) {
		return false, nil
	}

	if err := c.rt.WriteFile(ctx, containerName, jmosConfigPath, configYAML); err != nil {
		return false, fmt.Errorf("write jmos config: %w", err)
	}

	// Ensure config is readable by node user
	c.rt.Exec(ctx, containerName, "chown", "node:node", jmosConfigPath)

	log.Info().Str("container", containerName).Msg("jmos config written")
	return true, nil
}

// StartJMOS enables and starts the JMOS systemd service.
func (c *Client) StartJMOS(containerName string) error {
	ctx := context.Background()
	if _, err := c.rt.Exec(ctx, containerName, "systemctl", "start", jmosServiceName); err != nil {
		return fmt.Errorf("start jmos: %w", err)
	}
	return nil
}

// RestartJMOS restarts the JMOS service so updated config takes effect.
func (c *Client) RestartJMOS(containerName string) error {
	ctx := context.Background()
	if _, err := c.rt.Exec(ctx, containerName, "systemctl", "restart", jmosServiceName); err != nil {
		return fmt.Errorf("restart jmos: %w", err)
	}
	return nil
}

// EnsureJMOSRunning checks JMOS health and restarts if needed.
func (c *Client) EnsureJMOSRunning(containerName string) {
	if err := c.waitForContainerHealthURL(containerName, jmosHealthEndpoint, 5*1e9); err != nil {
		// Not healthy — restart via systemctl
		ctx := context.Background()
		if _, err := c.rt.Exec(ctx, containerName, "systemctl", "restart", jmosServiceName); err != nil {
			log.Warn().Err(err).Str("container", containerName).Msg("jmos restart failed")
			return
		}
		if err := c.waitForContainerHealthURL(containerName, jmosHealthEndpoint, 30*1e9); err != nil {
			log.Warn().Err(err).Str("container", containerName).Msg("jmos health check failed after restart")
		}
	}
}

// IsJMOSInstalled checks if the JMOS binary exists in the container.
func (c *Client) IsJMOSInstalled(containerName string) bool {
	ctx := context.Background()
	result, err := c.rt.Exec(ctx, containerName, "test", "-x", jmosBinaryPath)
	if err != nil {
		return false
	}
	return result.ExitCode == 0
}

func (c *Client) renderJMOSConfig(template []byte, userID, token string) ([]byte, error) {
	cfg := defaultJMOSConfig()
	if err := yaml.Unmarshal(template, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal jmos config template: %w", err)
	}

	workspaceRoot := resolveJMOSWorkspaceRoot(cfg.Workspace.Root)
	databasePath := resolveJMOSDatabasePath(cfg.Database.Path, workspaceRoot)

	if manifest, err := c.currentJMOSTemplate(userID); err == nil && manifest != nil {
		applyJMOSTemplateOverrides(&cfg, manifest, &workspaceRoot, &databasePath)
	}

	cfg.Workspace.Root = workspaceRoot
	cfg.Database.Type = "sqlite"
	cfg.Database.Path = databasePath
	if token != "" {
		cfg.Admin.Password = token
	}

	data, err := yaml.Marshal(&cfg)
	if err != nil {
		return nil, fmt.Errorf("marshal jmos config: %w", err)
	}
	return data, nil
}

func defaultJMOSConfig() jmosConfigFile {
	return jmosConfigFile{
		Project: jmosProjectConfig{Name: "JMOS"},
		Admin:   jmosAdminConfig{Password: "admin123"},
		Agent: jmosAgentConfig{
			RegistrationToken: "openclaw-register-2024",
			AllowRegistration: true,
		},
		Notification: jmosNotificationConfig{
			Enabled:  true,
			Channels: []string{},
			Events:   []string{"task_completed", "review_rejected", "all_done", "patrol_alert"},
		},
		Server: jmosServerConfig{
			Port: 6565,
			Host: "0.0.0.0",
		},
		Database: jmosDatabaseConfig{
			Type: "sqlite",
			Path: defaultJMOSDBPath,
		},
		Workspace: jmosWorkspaceConfig{
			Root: defaultJMOSWorkspace,
		},
		WebUI: jmosWebUIConfig{
			PublicFeed:        false,
			FeedRetentionDays: 7,
		},
	}
}

func applyJMOSTemplateOverrides(cfg *jmosConfigFile, manifest *openclawTemplateManifest, workspaceRoot, databasePath *string) {
	if cfg == nil || manifest == nil || workspaceRoot == nil || databasePath == nil {
		return
	}

	if name := strings.TrimSpace(manifest.DisplayName); name != "" {
		cfg.Project.Name = name
	} else if name := strings.TrimSpace(manifest.Name); name != "" {
		cfg.Project.Name = name
	}

	*workspaceRoot = resolveJMOSWorkspaceRoot(manifest.workspaceRoot())
	*databasePath = resolveJMOSDatabasePath(manifest.middlewareDatabasePath(), *workspaceRoot)
	if manifest.Middleware.Port > 0 {
		cfg.Server.Port = manifest.Middleware.Port
	}
}

func resolveJMOSWorkspaceRoot(root string) string {
	root = strings.TrimSpace(root)
	if root == "" || !strings.HasPrefix(root, "/") {
		return defaultJMOSWorkspace
	}
	return path.Clean(root)
}

func resolveJMOSDatabasePath(rawPath, workspaceRoot string) string {
	rawPath = strings.TrimSpace(rawPath)
	rawPath = strings.TrimPrefix(rawPath, "sqlite://")
	if rawPath == "" {
		return defaultJMOSDBPath
	}
	if strings.HasPrefix(rawPath, "/") {
		return path.Clean(rawPath)
	}

	base := workspaceRoot
	if base == "" || !strings.HasPrefix(base, "/") {
		base = defaultJMOSWorkspace
	}
	return path.Clean(path.Join(base, rawPath))
}

func (c *Client) currentJMOSTemplate(userID string) (*openclawTemplateManifest, error) {
	if c.store == nil {
		return nil, nil
	}

	templateName, err := c.store.GetContainerTemplate(context.Background(), userID, store.ContainerTypeOpenClaw)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(templateName) == "" {
		return nil, nil
	}

	manifest, _, err := c.loadTemplate(templateName)
	if err != nil {
		return nil, err
	}
	return manifest, nil
}

// loadJMOSConfigTemplate finds config.example.yaml from the jmos source directory.
func (c *Client) loadJMOSConfigTemplate() ([]byte, error) {
	candidates := make([]string, 0, 8)
	for _, key := range []string{"GATEWAY_JMOS_DIR", "JMOS_DIR"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			candidates = append(candidates, filepath.Join(v, "config.example.yaml"))
		}
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "openclaw", "jmos", "config.example.yaml"),
			filepath.Join(wd, "..", "openclaw", "jmos", "config.example.yaml"),
		)
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, "openclaw", "jmos", "config.example.yaml"),
			filepath.Join(exeDir, "..", "openclaw", "jmos", "config.example.yaml"),
			filepath.Join(exeDir, "..", "..", "openclaw", "jmos", "config.example.yaml"),
		)
	}
	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err == nil {
			return data, nil
		}
	}
	return nil, fmt.Errorf("jmos config.example.yaml not found")
}
