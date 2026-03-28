package incus

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	incusclient "github.com/lxc/incus/v6/client"
	"github.com/lxc/incus/v6/shared/api"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/container"
)

// Client implements container.Runtime using the Incus daemon.
// VMs get bridge IPs automatically and expose ports directly — no proxy devices needed.
type Client struct {
	server incusclient.InstanceServer
	hostIP string // legacy; VMs use bridge IPs directly
}

// NewClient connects to the local Incus daemon.
// socketPath can be empty to use the default Incus socket.
func NewClient(socketPath string, hostIP string) (*Client, error) {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}

	args := &incusclient.ConnectionArgs{}
	server, err := incusclient.ConnectIncusUnix(socketPath, args)
	if err != nil {
		return nil, fmt.Errorf("connect to incus: %w", err)
	}
	return &Client{server: server, hostIP: hostIP}, nil
}

// compile-time check
var _ container.Runtime = (*Client)(nil)

// ─── Lifecycle ─────────────────────────────────────

// Create creates and starts a new container from the given spec.
func (c *Client) Create(ctx context.Context, spec container.InstanceSpec) error {
	log.Info().Str("name", spec.Name).Str("image", spec.Image).Msg("incus: creating instance")

	config := map[string]string{}
	for k, v := range spec.Env {
		config["environment."+k] = v
	}
	if spec.MemoryMB > 0 {
		if spec.MemoryMB >= 1024 && spec.MemoryMB%1024 == 0 {
			config["limits.memory"] = fmt.Sprintf("%dGiB", spec.MemoryMB/1024)
		} else {
			config["limits.memory"] = fmt.Sprintf("%dMiB", spec.MemoryMB)
		}
	}
	if spec.CPUs > 0 {
		config["limits.cpu"] = strconv.Itoa(spec.CPUs)
	}

	devices := map[string]map[string]string{}

	// Bind mounts → disk devices (virtiofs on VMs, 9p on containers).
	// VMs don't support shift:true; ownership is fixed post-launch via chown.
	for i, m := range spec.BindMounts {
		devName := fmt.Sprintf("disk%d", i)
		devices[devName] = map[string]string{
			"type":   "disk",
			"source": m.Source,
			"path":   m.Target,
		}
	}

	// VMs get bridge IPs and expose ports directly — no proxy devices needed.
	// Port mappings (HostPort, ExtraPorts) are recorded in DB for reference
	// but not translated to Incus proxy devices.

	req := api.InstancesPost{
		Name: spec.Name,
		Type: api.InstanceTypeVM,
		Source: api.InstanceSource{
			Type:  "image",
			Alias: spec.Image,
		},
		InstancePut: api.InstancePut{
			Config:  config,
			Devices: devices,
		},
	}

	op, err := c.server.CreateInstance(req)
	if err != nil {
		return fmt.Errorf("incus create %s: %w", spec.Name, err)
	}
	if err := op.Wait(); err != nil {
		return fmt.Errorf("incus create %s wait: %w", spec.Name, err)
	}

	if err := c.Start(ctx, spec.Name); err != nil {
		return err
	}

	// Wait for the VM agent to be ready (VMs need time to boot the kernel
	// and start the incus-agent before file/exec operations work).
	return c.waitForAgent(spec.Name, 90*time.Second)
}

// Start starts a stopped instance.
func (c *Client) Start(ctx context.Context, name string) error {
	log.Info().Str("name", name).Msg("incus: starting instance")
	return c.updateState(name, "start", false)
}

// Stop stops a running instance.
func (c *Client) Stop(ctx context.Context, name string) error {
	log.Info().Str("name", name).Msg("incus: stopping instance")
	return c.updateState(name, "stop", true)
}

// Restart stops and starts an instance.
func (c *Client) Restart(ctx context.Context, name string) error {
	log.Info().Str("name", name).Msg("incus: restarting instance")
	return c.updateState(name, "restart", true)
}

// Freeze pauses a running instance (cgroup freezer).
func (c *Client) Freeze(ctx context.Context, name string) error {
	log.Info().Str("name", name).Msg("incus: freezing instance")
	return c.updateState(name, "freeze", false)
}

// Unfreeze resumes a frozen instance. If the instance is stopped, it starts it instead.
func (c *Client) Unfreeze(ctx context.Context, name string) error {
	info, err := c.Status(ctx, name)
	if err != nil {
		return err
	}

	switch info.Status {
	case "paused":
		log.Info().Str("name", name).Msg("incus: unfreezing instance")
		return c.updateState(name, "unfreeze", false)
	case "exited":
		return c.Start(ctx, name)
	case "running":
		return nil
	default:
		return fmt.Errorf("instance %s in unexpected state: %s", name, info.Status)
	}
}

// Unpause is an alias for Unfreeze (API compatibility).
func (c *Client) Unpause(ctx context.Context, name string) error {
	return c.Unfreeze(ctx, name)
}

// Remove force-stops and deletes an instance.
func (c *Client) Remove(ctx context.Context, name string) error {
	log.Warn().Str("name", name).Msg("incus: removing instance")

	// Force-stop first (ignore error if already stopped).
	_ = c.Stop(ctx, name)

	op, err := c.server.DeleteInstance(name)
	if err != nil {
		return fmt.Errorf("incus delete %s: %w", name, err)
	}
	return op.Wait()
}

// updateState is a helper that calls UpdateInstanceState and waits for the operation.
func (c *Client) updateState(name, action string, force bool) error {
	op, err := c.server.UpdateInstanceState(name, api.InstanceStatePut{
		Action:  action,
		Timeout: -1,
		Force:   force,
	}, "")
	if err != nil {
		return fmt.Errorf("incus %s %s: %w", action, name, err)
	}
	return op.Wait()
}

// ─── Inspect ───────────────────────────────────────

// Status returns the current status and IP of an instance.
func (c *Client) Status(ctx context.Context, name string) (*container.ContainerInfo, error) {
	state, _, err := c.server.GetInstanceState(name)
	if err != nil {
		if isNotFound(err) {
			return &container.ContainerInfo{Name: name, Status: "not_found"}, nil
		}
		return nil, fmt.Errorf("incus state %s: %w", name, err)
	}

	status := mapStatus(state.StatusCode)
	ip := extractIP(state)

	return &container.ContainerInfo{Name: name, Status: status, IP: ip}, nil
}

// List returns all container instances.
func (c *Client) List(ctx context.Context) ([]container.ContainerInfo, error) {
	instances, err := c.server.GetInstances(api.InstanceTypeAny)
	if err != nil {
		return nil, fmt.Errorf("incus list: %w", err)
	}

	result := make([]container.ContainerInfo, 0, len(instances))
	for _, inst := range instances {
		status := mapStatus(api.StatusCode(inst.StatusCode))
		ip := ""
		if status == "running" {
			state, _, err := c.server.GetInstanceState(inst.Name)
			if err == nil {
				ip = extractIP(state)
			}
		}
		result = append(result, container.ContainerInfo{
			Name:   inst.Name,
			Status: status,
			IP:     ip,
		})
	}
	return result, nil
}

// ─── Exec ──────────────────────────────────────────

// Exec runs a command inside the instance and returns the result.
func (c *Client) Exec(ctx context.Context, name string, cmd ...string) (*container.ExecResult, error) {
	if len(cmd) == 0 {
		return nil, fmt.Errorf("empty command")
	}

	var stdoutBuf, stderrBuf bytes.Buffer

	req := api.InstanceExecPost{
		Command:     cmd,
		WaitForWS:   true,
		Interactive: false,
	}

	args := &incusclient.InstanceExecArgs{
		Stdout: &stdoutBuf,
		Stderr: &stderrBuf,
	}

	op, err := c.server.ExecInstance(name, req, args)
	if err != nil {
		return nil, fmt.Errorf("incus exec %s: %w", name, err)
	}

	if err := op.Wait(); err != nil {
		// Return output even on non-zero exit.
		return &container.ExecResult{
			Stdout:   strings.TrimSpace(stdoutBuf.String()),
			Stderr:   strings.TrimSpace(stderrBuf.String()),
			ExitCode: -1,
		}, fmt.Errorf("incus exec %s: %w", name, err)
	}

	exitCode := 0
	opMeta := op.Get()
	if opMeta.Metadata != nil {
		if rc, ok := opMeta.Metadata["return"]; ok {
			switch v := rc.(type) {
			case float64:
				exitCode = int(v)
			case int:
				exitCode = v
			}
		}
	}

	return &container.ExecResult{
		Stdout:   strings.TrimSpace(stdoutBuf.String()),
		Stderr:   strings.TrimSpace(stderrBuf.String()),
		ExitCode: exitCode,
	}, nil
}

// ─── File I/O ──────────────────────────────────────

// WriteFile writes content to a file inside the instance.
func (c *Client) WriteFile(ctx context.Context, name, path string, content []byte) error {
	err := c.server.CreateInstanceFile(name, path, incusclient.InstanceFileArgs{
		Content: bytes.NewReader(content),
		Type:    "file",
		Mode:    0644,
		UID:     1000,
		GID:     1000,
	})
	if err != nil {
		return fmt.Errorf("incus write file %s:%s: %w", name, path, err)
	}
	return nil
}

// ReadFile reads a file from inside the instance.
func (c *Client) ReadFile(ctx context.Context, name, path string) (string, error) {
	reader, _, err := c.server.GetInstanceFile(name, path)
	if err != nil {
		return "", fmt.Errorf("incus read file %s:%s: %w", name, path, err)
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return "", fmt.Errorf("incus read file %s:%s: %w", name, path, err)
	}
	return string(data), nil
}

// ─── Logs ──────────────────────────────────────────

// Logs returns the last N lines of logs from inside the instance.
// Tries journalctl first, then falls back to /var/log/syslog or /var/log/messages.
func (c *Client) Logs(ctx context.Context, name string, lines int) (string, error) {
	if lines <= 0 || lines > 1000 {
		lines = 200
	}

	n := strconv.Itoa(lines)

	result, err := c.Exec(ctx, name, "journalctl", "--no-pager", "-n", n)
	if err == nil && strings.TrimSpace(result.Stdout) != "" {
		return result.Stdout, nil
	}

	result, err = c.Exec(ctx, name, "tail", "-n", n, "/var/log/syslog")
	if err == nil && strings.TrimSpace(result.Stdout) != "" {
		return result.Stdout, nil
	}

	result, err = c.Exec(ctx, name, "tail", "-n", n, "/var/log/messages")
	if err != nil {
		return "", fmt.Errorf("incus logs %s: no log source available", name)
	}
	return result.Stdout, nil
}

// ─── Health ────────────────────────────────────────

// WaitForHealth polls healthURL with HTTP GET until it returns 200 or the timeout elapses.
func (c *Client) WaitForHealth(ctx context.Context, name, healthURL string, timeout time.Duration) error {
	httpClient := &http.Client{Timeout: 5 * time.Second}
	deadline := time.Now().Add(timeout)

	log.Debug().Str("name", name).Str("url", healthURL).Dur("timeout", timeout).Msg("incus: waiting for health")

	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		resp, err := httpClient.Get(healthURL)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				log.Info().Str("name", name).Str("url", healthURL).Msg("incus: health check passed")
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("health check %s not ready after %s", healthURL, timeout)
}

// waitForAgent polls until the incus agent inside the VM is ready.
func (c *Client) waitForAgent(name string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	log.Info().Str("name", name).Dur("timeout", timeout).Msg("incus: waiting for VM agent")

	for time.Now().Before(deadline) {
		_, err := c.Exec(context.Background(), name, "true")
		if err == nil {
			log.Info().Str("name", name).Msg("incus: VM agent ready")
			return nil
		}
		time.Sleep(3 * time.Second)
	}
	return fmt.Errorf("VM agent not ready after %s for %s", timeout, name)
}

// ─── Helpers ───────────────────────────────────────

// mapStatus converts Incus status codes to our canonical status strings.
func mapStatus(code api.StatusCode) string {
	switch code {
	case api.Running:
		return "running"
	case api.Frozen:
		return "paused"
	case api.Stopped:
		return "exited"
	default:
		return "unknown"
	}
}

// extractIP finds the first non-loopback IPv4 address from instance network state.
func extractIP(state *api.InstanceState) string {
	if state == nil || state.Network == nil {
		return ""
	}

	// Prefer eth0 (containers) or enp5s0 (VMs).
	for _, iface := range []string{"eth0", "enp5s0"} {
		if net, ok := state.Network[iface]; ok {
			for _, addr := range net.Addresses {
				if addr.Family == "inet" && addr.Scope == "global" {
					return addr.Address
				}
			}
		}
	}

	// Fall back to any non-lo interface.
	for iface, net := range state.Network {
		if iface == "lo" {
			continue
		}
		for _, addr := range net.Addresses {
			if addr.Family == "inet" && addr.Scope == "global" {
				return addr.Address
			}
		}
	}
	return ""
}

// isNotFound checks whether an Incus API error is a 404 Not Found.
func isNotFound(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "Not Found")
}
