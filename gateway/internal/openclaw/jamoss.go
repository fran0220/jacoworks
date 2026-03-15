package openclaw

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/rs/zerolog/log"
)

const (
	jmosBinaryPath       = "/usr/local/bin/jmos"
	jmosConfigPath       = "/etc/jmos/config.yaml"
	jmosHealthEndpoint   = "http://127.0.0.1:6565/api/health"
	jmosServiceName      = "jmos.service"
)

// WriteJMOSConfig renders and writes JMOS config.yaml into the container.
// The JMOS binary and systemd service are pre-installed in the golden image.
func (c *Client) WriteJMOSConfig(containerName, userID, token string) error {
	configTemplate, err := c.loadJMOSConfigTemplate()
	if err != nil {
		return fmt.Errorf("load jmos config template: %w", err)
	}

	configYAML := renderJMOSConfig(configTemplate, userID, token)
	ctx := context.Background()

	if err := c.rt.WriteFile(ctx, containerName, jmosConfigPath, configYAML); err != nil {
		return fmt.Errorf("write jmos config: %w", err)
	}

	// Ensure config is readable by node user
	c.rt.Exec(ctx, containerName, "chown", "node:node", jmosConfigPath)

	log.Info().Str("container", containerName).Msg("jmos config written")
	return nil
}

// StartJMOS enables and starts the JMOS systemd service.
func (c *Client) StartJMOS(containerName string) error {
	ctx := context.Background()
	if _, err := c.rt.Exec(ctx, containerName, "systemctl", "start", jmosServiceName); err != nil {
		return fmt.Errorf("start jmos: %w", err)
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

func renderJMOSConfig(template []byte, userID, token string) []byte {
	s := string(template)
	s = strings.ReplaceAll(s, "${USER_ID}", userID)
	s = strings.ReplaceAll(s, "${GATEWAY_TOKEN}", token)
	return []byte(s)
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
