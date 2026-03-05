package docker

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// ContainerInfo represents the status of a Docker container.
type ContainerInfo struct {
	Name   string
	Status string // "running", "paused", "exited"
	IP     string
}

// CommandRunner abstracts shell command execution for testability.
type CommandRunner interface {
	Run(name string, args ...string) (string, error)
}

// execRunner is the default CommandRunner using os/exec.
type execRunner struct{}

func (r *execRunner) Run(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// Client manages Docker containers via SSH to a remote host.
type Client struct {
	sshTarget string // e.g. "opc@10.0.1.3"
	image     string // e.g. "jacoworks/vm-agent:latest"
	network   string // e.g. "agent-net"
	agentPort int    // vm-agent port (default 18789)
	runner    CommandRunner
}

func NewClient(sshTarget, image, network string, agentPort int) *Client {
	return &Client{
		sshTarget: sshTarget,
		image:     image,
		network:   network,
		agentPort: agentPort,
		runner:    &execRunner{},
	}
}

// ssh runs a command on the remote host (or locally if sshTarget is empty/"local").
func (c *Client) ssh(args ...string) (string, error) {
	if c.sshTarget == "" || c.sshTarget == "local" {
		return c.runner.Run("bash", append([]string{"-c"}, strings.Join(args, " "))...)
	}
	cmdArgs := append([]string{"-o", "StrictHostKeyChecking=no", c.sshTarget}, args...)
	return c.runner.Run("ssh", cmdArgs...)
}

// docker runs a docker command on the remote host.
func (c *Client) docker(args ...string) (string, error) {
	if c.sshTarget == "" || c.sshTarget == "local" {
		return c.runner.Run("docker", args...)
	}
	cmdArgs := append([]string{"-o", "StrictHostKeyChecking=no", c.sshTarget, "docker"}, args...)
	return c.runner.Run("ssh", cmdArgs...)
}

// Create creates and starts a new container from the configured image.
// Environment variables are injected at creation time via -e flags.
func (c *Client) Create(name string, envVars map[string]string) error {
	log.Info().Str("name", name).Str("image", c.image).Msg("creating container")

	args := []string{
		"run", "-d",
		"--name", name,
		"--network", c.network,
		"--restart", "unless-stopped",
	}
	for k, v := range envVars {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}
	args = append(args, c.image)

	_, err := c.docker(args...)
	if err != nil {
		return fmt.Errorf("docker run %s: %w", name, err)
	}
	return nil
}

// Start starts a stopped container.
func (c *Client) Start(name string) error {
	log.Info().Str("name", name).Msg("starting container")
	_, err := c.docker("start", name)
	if err != nil {
		return fmt.Errorf("docker start %s: %w", name, err)
	}
	return nil
}

// Stop stops a running container.
func (c *Client) Stop(name string) error {
	log.Info().Str("name", name).Msg("stopping container")
	_, err := c.docker("stop", name)
	if err != nil {
		return fmt.Errorf("docker stop %s: %w", name, err)
	}
	return nil
}

// Pause pauses a running container (lightweight freeze).
func (c *Client) Pause(name string) error {
	log.Info().Str("name", name).Msg("pausing container")
	_, err := c.docker("pause", name)
	if err != nil {
		return fmt.Errorf("docker pause %s: %w", name, err)
	}
	return nil
}

// Unpause resumes a paused container.
func (c *Client) Unpause(name string) error {
	log.Info().Str("name", name).Msg("unpausing container")
	_, err := c.docker("unpause", name)
	if err != nil {
		return fmt.Errorf("docker unpause %s: %w", name, err)
	}
	return nil
}

// Freeze is an alias for Pause (LXD-compatible interface).
func (c *Client) Freeze(name string) error {
	return c.Pause(name)
}

// Unfreeze resumes a paused container and waits for health.
func (c *Client) Unfreeze(name string) error {
	status, err := c.Status(name)
	if err != nil {
		return err
	}

	switch status.Status {
	case "paused":
		if err := c.Unpause(name); err != nil {
			return err
		}
	case "exited":
		if err := c.Start(name); err != nil {
			return err
		}
	case "running":
		return nil
	default:
		return fmt.Errorf("container %s in unexpected state: %s", name, status.Status)
	}

	time.Sleep(2 * time.Second)

	ip, err := c.GetIP(name)
	if err != nil {
		return fmt.Errorf("get IP after unfreeze: %w", err)
	}
	return c.WaitForHealth(ip, 30*time.Second)
}

// Destroy force-removes a container.
func (c *Client) Destroy(name string) error {
	log.Warn().Str("name", name).Msg("destroying container")
	_, err := c.docker("rm", "-f", name)
	if err != nil {
		return fmt.Errorf("docker rm %s: %w", name, err)
	}
	return nil
}

// dockerPSJSON represents the JSON output of `docker ps --format json`.
type dockerPSJSON struct {
	Names  string `json:"Names"`
	State  string `json:"State"`  // running, paused, exited
	Status string `json:"Status"` // human-readable like "Up 2 hours"
}

// Status returns the status of a specific container.
func (c *Client) Status(name string) (*ContainerInfo, error) {
	out, err := c.docker("ps", "-a", "--filter", "name=^/"+name+"$", "--format", "json")
	if err != nil {
		return nil, fmt.Errorf("docker ps %s: %w", name, err)
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return nil, fmt.Errorf("container %s not found", name)
	}

	// docker ps --format json outputs one JSON object per line
	line := strings.SplitN(out, "\n", 2)[0]
	var ps dockerPSJSON
	if err := json.Unmarshal([]byte(line), &ps); err != nil {
		return nil, fmt.Errorf("parse docker ps json: %w", err)
	}

	ip := ""
	if ps.State == "running" {
		ip, _ = c.getIPByInspect(name)
	}

	return &ContainerInfo{
		Name:   name,
		Status: ps.State,
		IP:     ip,
	}, nil
}

// GetIP returns the container's IP address on the configured network.
func (c *Client) GetIP(name string) (string, error) {
	ip, err := c.getIPByInspect(name)
	if err != nil {
		return "", err
	}
	if ip == "" {
		return "", fmt.Errorf("container %s has no IP", name)
	}
	return ip, nil
}

func (c *Client) getIPByInspect(name string) (string, error) {
	out, err := c.docker("inspect", name)
	if err != nil {
		return "", fmt.Errorf("docker inspect %s: %w", name, err)
	}
	// Parse JSON output to extract IP from NetworkSettings
	var containers []struct {
		NetworkSettings struct {
			Networks map[string]struct {
				IPAddress string `json:"IPAddress"`
			} `json:"Networks"`
		} `json:"NetworkSettings"`
	}
	if err := json.Unmarshal([]byte(out), &containers); err != nil {
		return "", fmt.Errorf("parse docker inspect json: %w", err)
	}
	if len(containers) == 0 {
		return "", fmt.Errorf("container %s not found", name)
	}
	for _, net := range containers[0].NetworkSettings.Networks {
		if net.IPAddress != "" {
			return net.IPAddress, nil
		}
	}
	return "", nil
}

// List returns all containers matching the "agent-" prefix.
func (c *Client) List() ([]ContainerInfo, error) {
	out, err := c.docker("ps", "-a", "--filter", "name=agent-", "--format", "json")
	if err != nil {
		return nil, fmt.Errorf("docker ps: %w", err)
	}
	out = strings.TrimSpace(out)
	if out == "" {
		return nil, nil
	}

	var containers []ContainerInfo
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ps dockerPSJSON
		if err := json.Unmarshal([]byte(line), &ps); err != nil {
			log.Warn().Err(err).Str("line", line).Msg("skip unparseable docker ps line")
			continue
		}

		ip := ""
		if ps.State == "running" {
			ip, _ = c.getIPByInspect(ps.Names)
		}

		containers = append(containers, ContainerInfo{
			Name:   ps.Names,
			Status: ps.State,
			IP:     ip,
		})
	}
	return containers, nil
}

// WaitForHealth polls the agent health endpoint until ready.
func (c *Client) WaitForHealth(ip string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	healthURL := fmt.Sprintf("http://%s:%d/health", ip, c.agentPort)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 %s", healthURL)

	log.Debug().Str("url", healthURL).Dur("timeout", timeout).Msg("waiting for container health")

	for time.Now().Before(deadline) {
		out, err := c.ssh(curlCmd)
		if err == nil {
			code := strings.TrimSpace(strings.Trim(out, "'"))
			if len(code) == 3 && code[0] >= '1' && code[0] <= '5' && code != "000" {
				log.Info().Str("url", healthURL).Str("status", code).Msg("container healthy")
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("container at %s not healthy after %s", ip, timeout)
}

// Exec runs a command inside a container via docker exec.
func (c *Client) Exec(container string, args ...string) (string, error) {
	dockerArgs := append([]string{"exec", container}, args...)
	return c.docker(dockerArgs...)
}

// ─── Memory Sync ───────────────────────────────────

const (
	containerWorkspace = "/home/agent/.openclaw/workspace"
	containerSkillsDir = "/home/agent/.openclaw/skills"
)

func canonicalToContainerPath(canonical string) string {
	if canonical == "MEMORY.md" {
		return containerWorkspace + "/MEMORY.md"
	}
	if strings.HasPrefix(canonical, "daily/") {
		filename := strings.TrimPrefix(canonical, "daily/")
		return containerWorkspace + "/memory/" + filename
	}
	return containerWorkspace + "/" + canonical
}

func containerToCanonicalPath(containerPath string) string {
	rel := strings.TrimPrefix(containerPath, containerWorkspace+"/")
	if rel == "MEMORY.md" {
		return "MEMORY.md"
	}
	if strings.HasPrefix(rel, "memory/") {
		return "daily/" + strings.TrimPrefix(rel, "memory/")
	}
	return rel
}

// PushMemoryFiles writes memory files into a container using docker cp.
func (c *Client) PushMemoryFiles(containerName string, files map[string]string) error {
	if len(files) == 0 {
		return nil
	}

	c.docker("exec", containerName, "mkdir", "-p", containerWorkspace+"/memory")

	for canonical, content := range files {
		containerPath := canonicalToContainerPath(canonical)

		tmpFile := fmt.Sprintf("/tmp/_mem_%s_%s", containerName,
			strings.ReplaceAll(strings.ReplaceAll(canonical, "/", "_"), ".", "_"))

		writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s",
			strings.ReplaceAll(content, "'", "'\\''"), tmpFile)
		if _, err := c.ssh(writeCmd); err != nil {
			log.Warn().Err(err).Str("file", canonical).Msg("push memory: write temp failed")
			continue
		}

		cpCmd := fmt.Sprintf("docker cp %s %s:%s && rm -f %s", tmpFile, containerName, containerPath, tmpFile)
		if _, err := c.ssh(cpCmd); err != nil {
			log.Warn().Err(err).Str("file", canonical).Msg("push memory: docker cp failed")
			continue
		}
	}

	log.Info().Str("container", containerName).Int("files", len(files)).Msg("memory files pushed")
	return nil
}

// PullMemoryFiles reads memory files from a container.
func (c *Client) PullMemoryFiles(containerName string) (map[string]string, error) {
	files := make(map[string]string)

	memPath := containerWorkspace + "/MEMORY.md"
	if content, err := c.docker("exec", containerName, "cat", memPath); err == nil {
		content = strings.TrimSpace(content)
		if content != "" {
			files["MEMORY.md"] = content
		}
	}

	listCmd := fmt.Sprintf("ls -1 %s/memory/*.md 2>/dev/null", containerWorkspace)
	out, err := c.docker("exec", containerName, "sh", "-c", listCmd)
	if err == nil && strings.TrimSpace(out) != "" {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || !strings.HasSuffix(line, ".md") {
				continue
			}
			content, err := c.docker("exec", containerName, "cat", line)
			if err != nil {
				continue
			}
			content = strings.TrimSpace(content)
			if content == "" {
				continue
			}
			canonical := containerToCanonicalPath(line)
			files[canonical] = content
		}
	}

	return files, nil
}

// PushSkillFiles writes skill files into a container.
func (c *Client) PushSkillFiles(containerName string, files map[string]string) error {
	if len(files) == 0 {
		return nil
	}

	c.docker("exec", containerName, "mkdir", "-p", containerSkillsDir)

	for relPath, content := range files {
		fullPath := containerSkillsDir + "/" + relPath
		dir := fullPath[:strings.LastIndex(fullPath, "/")]

		c.docker("exec", containerName, "mkdir", "-p", dir)

		tmpFile := fmt.Sprintf("/tmp/_skill_%s_%s", containerName,
			strings.ReplaceAll(strings.ReplaceAll(relPath, "/", "_"), ".", "_"))

		writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s",
			strings.ReplaceAll(content, "'", "'\\''"), tmpFile)
		if _, err := c.ssh(writeCmd); err != nil {
			log.Warn().Err(err).Str("file", relPath).Msg("push skill: write temp failed")
			continue
		}

		cpCmd := fmt.Sprintf("docker cp %s %s:%s && rm -f %s", tmpFile, containerName, fullPath, tmpFile)
		if _, err := c.ssh(cpCmd); err != nil {
			log.Warn().Err(err).Str("file", relPath).Msg("push skill: docker cp failed")
			continue
		}
	}

	log.Info().Str("container", containerName).Int("files", len(files)).Msg("skill files pushed")
	return nil
}

// ProvisionContainer creates a new container with env vars injected and waits for health.
func (c *Client) ProvisionContainer(name, containerToken string, envVars map[string]string) (string, error) {
	log.Info().Str("name", name).Str("image", c.image).Msg("provisioning container")

	// Merge all env vars including the container token
	allEnv := make(map[string]string, len(envVars)+1)
	for k, v := range envVars {
		allEnv[k] = v
	}
	allEnv["OPENCLAW_GATEWAY_TOKEN"] = containerToken

	if err := c.Create(name, allEnv); err != nil {
		return "", fmt.Errorf("create: %w", err)
	}

	// Wait for container to start
	time.Sleep(3 * time.Second)

	ip, err := c.GetIP(name)
	if err != nil {
		return "", fmt.Errorf("get ip: %w", err)
	}

	if err := c.WaitForHealth(ip, 30*time.Second); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("container started but health check failed")
	}

	log.Info().Str("name", name).Str("ip", ip).Msg("container provisioned")
	return ip, nil
}
