package lxd

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// SSHClient manages LXD containers via SSH to the host machine.
// This is simpler than calling the LXD REST API directly and works
// well for development. For production, replace with HTTP client.
type SSHClient struct {
	sshTarget    string // e.g. "local" or "root@192.168.31.162"
	template     string // e.g. "tpl-openclaw"
	network      string // e.g. "jaconet"
	openclawPort int
}

func NewSSHClient(sshTarget, template, network string, openclawPort int) *SSHClient {
	return &SSHClient{
		sshTarget:    sshTarget,
		template:     template,
		network:      network,
		openclawPort: openclawPort,
	}
}

func (c *SSHClient) lxc(args ...string) (string, error) {
	var cmd *exec.Cmd
	if c.sshTarget == "" || c.sshTarget == "local" {
		// Run lxc directly on this host
		cmd = exec.Command("lxc", args...)
	} else {
		cmdArgs := append([]string{c.sshTarget, "lxc"}, args...)
		cmd = exec.Command("ssh", cmdArgs...)
	}
	out, err := cmd.CombinedOutput()
	result := strings.TrimSpace(string(out))
	if err != nil {
		return result, fmt.Errorf("lxc %s: %s (%w)", strings.Join(args, " "), result, err)
	}
	return result, nil
}

func (c *SSHClient) Clone(templateName, newName string) error {
	log.Info().Str("template", templateName).Str("name", newName).Msg("cloning container")
	_, err := c.lxc("copy", templateName, newName)
	return err
}

func (c *SSHClient) Start(name string) error {
	log.Info().Str("name", name).Msg("starting container")
	_, err := c.lxc("start", name)
	return err
}

func (c *SSHClient) Stop(name string) error {
	log.Info().Str("name", name).Msg("stopping container")
	_, err := c.lxc("stop", name)
	return err
}

func (c *SSHClient) Freeze(name string) error {
	log.Info().Str("name", name).Msg("freezing container")
	_, err := c.lxc("pause", name)
	return err
}

func (c *SSHClient) Unfreeze(name string) error {
	log.Info().Str("name", name).Msg("unfreezing container")

	// Get current state first
	status, err := c.Status(name)
	if err != nil {
		return err
	}

	if status.Status == "Frozen" {
		// LXD doesn't have an "unpause" — we start the frozen container
		_, err = c.lxc("start", name)
		if err != nil {
			return err
		}
	}

	// Wait for OpenClaw gateway to be ready
	ip, err := c.GetIP(name)
	if err != nil {
		return fmt.Errorf("get IP after unfreeze: %w", err)
	}

	return c.waitForHealth(ip, 10*time.Second)
}

func (c *SSHClient) Destroy(name string) error {
	log.Warn().Str("name", name).Msg("destroying container")
	// Force stop first
	c.lxc("stop", name, "--force")
	_, err := c.lxc("delete", name)
	return err
}

// lxcJSON represents the JSON output of `lxc list --format=json`.
type lxcJSON struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	State  *struct {
		Network map[string]struct {
			Addresses []struct {
				Family  string `json:"family"`
				Address string `json:"address"`
				Scope   string `json:"scope"`
			} `json:"addresses"`
		} `json:"network"`
	} `json:"state"`
}

// extractEth0IP gets the eth0 IPv4 address from lxc JSON, skipping docker/loopback.
func extractEth0IP(c lxcJSON) string {
	if c.State == nil || c.State.Network == nil {
		return ""
	}
	// Prefer eth0, fall back to first non-docker non-lo interface
	for _, iface := range []string{"eth0", "enp5s0", "ens3"} {
		if net, ok := c.State.Network[iface]; ok {
			for _, addr := range net.Addresses {
				if addr.Family == "inet" && addr.Scope == "global" {
					return addr.Address
				}
			}
		}
	}
	return ""
}

func (c *SSHClient) Status(name string) (*ContainerStatus, error) {
	out, err := c.lxc("list", name, "--format=json")
	if err != nil {
		return nil, err
	}

	var containers []lxcJSON
	if err := json.Unmarshal([]byte(out), &containers); err != nil {
		return nil, fmt.Errorf("parse json: %w", err)
	}

	for _, ct := range containers {
		if ct.Name == name {
			return &ContainerStatus{
				Name:   ct.Name,
				Status: ct.Status,
				IP:     extractEth0IP(ct),
			}, nil
		}
	}
	return nil, fmt.Errorf("container %s not found", name)
}

func (c *SSHClient) GetIP(name string) (string, error) {
	status, err := c.Status(name)
	if err != nil {
		return "", err
	}
	if status.IP == "" {
		return "", fmt.Errorf("container %s has no IP", name)
	}
	return status.IP, nil
}

func (c *SSHClient) List() ([]ContainerStatus, error) {
	out, err := c.lxc("list", "--format=json")
	if err != nil {
		return nil, err
	}

	var raw []lxcJSON
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return nil, fmt.Errorf("parse json: %w", err)
	}

	containers := make([]ContainerStatus, 0, len(raw))
	for _, ct := range raw {
		containers = append(containers, ContainerStatus{
			Name:   ct.Name,
			Status: ct.Status,
			IP:     extractEth0IP(ct),
		})
	}
	return containers, nil
}

// waitForHealth polls the OpenClaw health endpoint until ready.
func (c *SSHClient) waitForHealth(ip string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	healthURL := fmt.Sprintf("http://%s:%d/health", ip, c.openclawPort)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 %s", healthURL)

	for time.Now().Before(deadline) {
		out, err := c.sshExec(curlCmd)
		if err == nil && strings.TrimSpace(strings.Trim(out, "'")) == "200" {
			return nil
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("container at %s not healthy after %s", ip, timeout)
}

// sshExec runs a command on the host (directly or via SSH).
func (c *SSHClient) sshExec(cmdStr string) (string, error) {
	var cmd *exec.Cmd
	if c.sshTarget == "" || c.sshTarget == "local" {
		cmd = exec.Command("bash", "-c", cmdStr)
	} else {
		cmd = exec.Command("ssh", c.sshTarget, cmdStr)
	}
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// ProvisionContainer clones from template, injects .env, starts, and returns IP.
func (c *SSHClient) ProvisionContainer(name, containerToken string, envVars map[string]string) (string, error) {
	log.Info().Str("name", name).Str("template", c.template).Msg("provisioning container")

	// 1. Clone from template snapshot
	if _, err := c.lxc("copy", c.template+"/v2-full-verified", name); err != nil {
		return "", fmt.Errorf("clone: %w", err)
	}

	// 2. Start
	if err := c.Start(name); err != nil {
		c.Destroy(name)
		return "", fmt.Errorf("start: %w", err)
	}

	// 3. Wait for network
	time.Sleep(3 * time.Second)

	// 4. Inject .env via lxc file push (avoids shell escaping issues)
	envContent := fmt.Sprintf(
		"LLM_PROXY_URL=%s\nLLM_PROXY_KEY=%s\nOPENCLAW_GATEWAY_TOKEN=%s\nNODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt\n",
		envVars["LLM_PROXY_URL"], envVars["LLM_PROXY_KEY"], containerToken,
	)
	// Write to host temp file, then push into container
	tmpCmd := fmt.Sprintf("echo -e '%s' > /tmp/_oc_env_%s", strings.ReplaceAll(envContent, "'", "'\\''"), name)
	if _, err := c.sshExec(tmpCmd); err != nil {
		return "", fmt.Errorf("write temp env: %w", err)
	}
	pushCmd := fmt.Sprintf("lxc file push /tmp/_oc_env_%s %s/home/agent/.openclaw/.env --uid 1001 --gid 1001 --mode 0600 && rm -f /tmp/_oc_env_%s", name, name, name)
	if _, err := c.sshExec(pushCmd); err != nil {
		return "", fmt.Errorf("push env: %w", err)
	}

	// 5. Restart OpenClaw to pick up new token
	if _, err := c.lxc("exec", name, "--", "systemctl", "restart", "openclaw.service"); err != nil {
		return "", fmt.Errorf("restart openclaw: %w", err)
	}

	// 5.5 Auto-approve devices pairing (operator→admin scope for sessions_spawn)
	time.Sleep(3 * time.Second)
	c.autoApproveDevices(name)

	// 6. Get IP
	ip, err := c.GetIP(name)
	if err != nil {
		return "", fmt.Errorf("get ip: %w", err)
	}

	// 7. Wait for health
	if err := c.waitForHealth(ip, 30*time.Second); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("container started but health check failed")
	}

	log.Info().Str("name", name).Str("ip", ip).Msg("container provisioned")
	return ip, nil
}

// autoApproveDevices approves all pending pairing requests in a container.
func (c *SSHClient) autoApproveDevices(name string) {
	// List pending requests
	out, _ := c.lxc("exec", name, "--", "su", "-", "agent", "-c", "openclaw devices list 2>&1")

	// Parse pending request IDs (lines with UUID pattern after "│")
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		// Look for lines containing a UUID-like request ID
		if !strings.Contains(line, "│") {
			continue
		}
		parts := strings.Split(line, "│")
		if len(parts) < 2 {
			continue
		}
		reqID := strings.TrimSpace(parts[1])
		// UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
		if len(reqID) == 36 && strings.Count(reqID, "-") == 4 {
			log.Info().Str("container", name).Str("request_id", reqID).Msg("auto-approving device pairing")
			c.lxc("exec", name, "--", "su", "-", "agent", "-c", "openclaw devices approve "+reqID)
		}
	}
}
