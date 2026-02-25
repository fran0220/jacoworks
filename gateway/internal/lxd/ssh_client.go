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

// Exec runs a command inside a container via lxc exec.
func (c *SSHClient) Exec(container string, args ...string) (string, error) {
	lxcArgs := append([]string{"exec", container, "--"}, args...)
	return c.lxc(lxcArgs...)
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

// DeviceKeyInfo holds the gateway's Ed25519 device key info for auto-pairing.
type DeviceKeyInfo struct {
	DeviceID  string
	PublicKey string // base64url encoded
}

func gatewayDeviceEntry(deviceID, publicKey string, nowMs int64) map[string]any {
	scopes := []string{"operator.admin", "operator.approvals", "operator.pairing", "operator.read", "operator.write"}
	return map[string]any{
		"deviceId":       deviceID,
		"publicKey":      publicKey,
		"platform":       "web",
		"clientId":       "gateway-client",
		"clientMode":     "backend",
		"role":           "operator",
		"roles":          []string{"operator"},
		"scopes":         scopes,
		"approvedScopes": scopes,
		"remoteIp":       "10.10.10.1",
		"tokens": map[string]any{
			"operator": map[string]any{
				"token":       "auto-paired-gateway",
				"role":        "operator",
				"scopes":      scopes,
				"createdAtMs": nowMs,
			},
		},
		"createdAtMs":  nowMs,
		"approvedAtMs": nowMs,
	}
}

func (c *SSHClient) injectGatewayDeviceKey(name string, deviceKey *DeviceKeyInfo) error {
	if deviceKey == nil || deviceKey.DeviceID == "" || deviceKey.PublicKey == "" {
		return nil
	}

	pairedPath := "/home/agent/.openclaw/devices/paired.json"
	if _, err := c.lxc("exec", name, "--", "mkdir", "-p", "/home/agent/.openclaw/devices"); err != nil {
		return fmt.Errorf("prepare devices dir: %w", err)
	}

	out, err := c.lxc("exec", name, "--", "sh", "-lc", "cat "+pairedPath+" 2>/dev/null || true")
	if err != nil {
		return fmt.Errorf("read paired.json: %w", err)
	}

	paired := map[string]map[string]any{}
	trimmed := strings.TrimSpace(out)
	if trimmed != "" {
		if err := json.Unmarshal([]byte(trimmed), &paired); err != nil {
			return fmt.Errorf("parse paired.json: %w", err)
		}
	}

	if existing, ok := paired[deviceKey.DeviceID]; ok {
		if existingPublicKey, ok := existing["publicKey"].(string); ok && existingPublicKey == deviceKey.PublicKey {
			return nil
		}
	}

	paired[deviceKey.DeviceID] = gatewayDeviceEntry(deviceKey.DeviceID, deviceKey.PublicKey, time.Now().UnixMilli())

	payload, err := json.MarshalIndent(paired, "", "  ")
	if err != nil {
		return fmt.Errorf("encode paired.json: %w", err)
	}

	tmpFile := fmt.Sprintf("/tmp/_oc_paired_%s", strings.ReplaceAll(name, "/", "_"))
	writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s", strings.ReplaceAll(string(payload), "'", "'\\''"), tmpFile)
	if _, err := c.sshExec(writeCmd); err != nil {
		return fmt.Errorf("write temp paired.json: %w", err)
	}

	pushCmd := fmt.Sprintf("lxc file push %s %s%s --uid 1001 --gid 1001 --mode 0600 && rm -f %s", tmpFile, name, pairedPath, tmpFile)
	if _, err := c.sshExec(pushCmd); err != nil {
		return fmt.Errorf("push paired.json: %w", err)
	}

	return nil
}

// ProvisionContainer clones from template, injects .env, starts, and returns IP.
func (c *SSHClient) ProvisionContainer(name, containerToken string, envVars map[string]string, deviceKey *DeviceKeyInfo) (string, error) {
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

	// 4. Inject .env via printf + lxc file push (safe from echo -e backslash mangling)
	envContent := fmt.Sprintf(
		"LLM_PROXY_URL=%s\nLLM_PROXY_KEY=%s\nOPENCLAW_GATEWAY_TOKEN=%s\nNODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt\n",
		envVars["LLM_PROXY_URL"], envVars["LLM_PROXY_KEY"], containerToken,
	)
	tmpFile := fmt.Sprintf("/tmp/_oc_env_%s", name)
	writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s", strings.ReplaceAll(envContent, "'", "'\\''"), tmpFile)
	if _, err := c.sshExec(writeCmd); err != nil {
		return "", fmt.Errorf("write temp env: %w", err)
	}
	pushCmd := fmt.Sprintf("lxc file push %s %s/home/agent/.openclaw/.env --uid 1001 --gid 1001 --mode 0600 && rm -f %s", tmpFile, name, tmpFile)
	if _, err := c.sshExec(pushCmd); err != nil {
		return "", fmt.Errorf("push env: %w", err)
	}

	// 4.5 Inject gateway device key into paired.json BEFORE restart
	if deviceKey != nil {
		if err := c.injectGatewayDeviceKey(name, deviceKey); err != nil {
			log.Warn().Err(err).Str("name", name).Msg("failed to inject gateway device key during provisioning")
		} else {
			log.Info().Str("name", name).Str("device_id", deviceKey.DeviceID).Msg("gateway device key injected before restart")
		}
	}

	// 5. Restart OpenClaw to pick up new token (try systemctl, fallback to kill+wait)
	if _, err := c.lxc("exec", name, "--", "systemctl", "restart", "openclaw.service"); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("systemctl restart failed, falling back to process restart")
		c.lxc("exec", name, "--", "bash", "-c", "pkill -u agent openclaw; sleep 2")
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

// MountDisk adds a disk device to a container.
func (c *SSHClient) MountDisk(container, device, hostPath, containerPath string) error {
	_, err := c.lxc("config", "device", "add", container, device, "disk",
		"source="+hostPath, "path="+containerPath)
	return err
}

// UnmountDisk removes a disk device from a container.
func (c *SSHClient) UnmountDisk(container, device string) error {
	_, err := c.lxc("config", "device", "remove", container, device)
	return err
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
