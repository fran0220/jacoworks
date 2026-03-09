package docker

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"os/exec"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	dockerclient "github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
	"github.com/rs/zerolog/log"
)

// ContainerInfo represents the status of a Docker container.
type ContainerInfo struct {
	Name   string
	Status string // "running", "paused", "exited"
	IP     string
}

// dockerAPI defines the subset of Docker client API used by this package.
type dockerAPI interface {
	ContainerCreate(ctx context.Context, config *container.Config, hostConfig *container.HostConfig, networkingConfig *network.NetworkingConfig, platform *ocispec.Platform, containerName string) (container.CreateResponse, error)
	ContainerStart(ctx context.Context, containerID string, options types.ContainerStartOptions) error
	ContainerStop(ctx context.Context, containerID string, options container.StopOptions) error
	ContainerPause(ctx context.Context, containerID string) error
	ContainerUnpause(ctx context.Context, containerID string) error
	ContainerRemove(ctx context.Context, containerID string, options types.ContainerRemoveOptions) error
	ContainerInspect(ctx context.Context, containerID string) (types.ContainerJSON, error)
	ContainerList(ctx context.Context, options types.ContainerListOptions) ([]types.Container, error)
	ContainerExecCreate(ctx context.Context, container string, config types.ExecConfig) (types.IDResponse, error)
	ContainerExecAttach(ctx context.Context, execID string, config types.ExecStartCheck) (types.HijackedResponse, error)
	ContainerLogs(ctx context.Context, container string, options types.ContainerLogsOptions) (io.ReadCloser, error)
	CopyToContainer(ctx context.Context, containerID, dstPath string, content io.Reader, options types.CopyToContainerOptions) error
	CopyFromContainer(ctx context.Context, containerID, srcPath string) (io.ReadCloser, types.ContainerPathStat, error)
}

// Client manages Docker containers via the Docker SDK.
type Client struct {
	sshTarget string // e.g. "opc@10.0.1.3"
	image     string // e.g. "jacoworks/vm-agent:latest"
	network   string // e.g. "agent-net"
	agentPort int    // vm-agent port (default 18789)
	hostIP    string // WireGuard IP to bind ports (e.g. "10.0.1.3")
	cli       dockerAPI
}

func NewClient(sshTarget, image, network string, agentPort int, hostIP string) *Client {
	c := &Client{
		sshTarget: sshTarget,
		image:     image,
		network:   network,
		agentPort: agentPort,
		hostIP:    hostIP,
	}

	var opts []dockerclient.Opt
	if sshTarget == "" || sshTarget == "local" {
		opts = append(opts, dockerclient.FromEnv)
	} else {
		opts = append(opts,
			dockerclient.WithHost("http://docker"),
			dockerclient.WithDialContext(c.sshDialContext),
		)
	}
	opts = append(opts, dockerclient.WithAPIVersionNegotiation())

	cli, err := dockerclient.NewClientWithOpts(opts...)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to create docker client")
	}
	c.cli = cli
	return c
}

// sshDialContext creates a connection to the remote Docker daemon via SSH.
// It spawns "ssh user@host docker system dial-stdio" and returns a net.Conn
// backed by the SSH process's stdin/stdout.
func (c *Client) sshDialContext(ctx context.Context, _, _ string) (net.Conn, error) {
	args := []string{
		"-o", "StrictHostKeyChecking=no",
		"-o", "ConnectTimeout=10",
		c.sshTarget,
		"docker", "system", "dial-stdio",
	}
	cmd := exec.CommandContext(ctx, "ssh", args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("ssh stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("ssh stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("ssh start: %w", err)
	}
	return &sshConn{cmd: cmd, stdin: stdin, stdout: stdout}, nil
}

// sshConn wraps an SSH subprocess as a net.Conn.
type sshConn struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
}

func (c *sshConn) Read(p []byte) (int, error)  { return c.stdout.Read(p) }
func (c *sshConn) Write(p []byte) (int, error) { return c.stdin.Write(p) }
func (c *sshConn) Close() error {
	_ = c.stdin.Close()
	_ = c.stdout.Close()
	return c.cmd.Wait()
}
func (c *sshConn) LocalAddr() net.Addr                { return &net.UnixAddr{Name: "ssh", Net: "ssh"} }
func (c *sshConn) RemoteAddr() net.Addr               { return &net.UnixAddr{Name: "ssh", Net: "ssh"} }
func (c *sshConn) SetDeadline(_ time.Time) error       { return nil }
func (c *sshConn) SetReadDeadline(_ time.Time) error   { return nil }
func (c *sshConn) SetWriteDeadline(_ time.Time) error  { return nil }

// RunSSH runs a command on the remote host via SSH.
// Deprecated: Use Docker SDK methods or Exec instead. Kept for openclaw config writing.
func (c *Client) RunSSH(args ...string) (string, error) {
	if c.sshTarget == "" || c.sshTarget == "local" {
		cmd := exec.Command("bash", append([]string{"-c"}, strings.Join(args, " "))...)
		out, err := cmd.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	cmdArgs := append([]string{"-o", "StrictHostKeyChecking=no", c.sshTarget}, args...)
	cmd := exec.Command("ssh", cmdArgs...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// Create creates and starts a new container from the configured image.
func (c *Client) Create(name string, envVars map[string]string, hostPort int) error {
	log.Info().Str("name", name).Str("image", c.image).Int("host_port", hostPort).Msg("creating container")
	ctx := context.Background()

	var env []string
	for k, v := range envVars {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	containerCfg := &container.Config{
		Image: c.image,
		Env:   env,
	}

	hostCfg := &container.HostConfig{
		NetworkMode:   container.NetworkMode(c.network),
		RestartPolicy: container.RestartPolicy{Name: "unless-stopped"},
	}

	if hostPort > 0 {
		port := nat.Port(fmt.Sprintf("%d/tcp", c.agentPort))
		hostCfg.PortBindings = nat.PortMap{
			port: []nat.PortBinding{
				{HostIP: c.hostIP, HostPort: fmt.Sprintf("%d", hostPort)},
			},
		}
	}

	resp, err := c.cli.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, name)
	if err != nil {
		return fmt.Errorf("docker run %s: %w", name, err)
	}

	if err := c.cli.ContainerStart(ctx, resp.ID, types.ContainerStartOptions{}); err != nil {
		return fmt.Errorf("docker start %s: %w", name, err)
	}
	return nil
}

// Start starts a stopped container.
func (c *Client) Start(name string) error {
	log.Info().Str("name", name).Msg("starting container")
	if err := c.cli.ContainerStart(context.Background(), name, types.ContainerStartOptions{}); err != nil {
		return fmt.Errorf("docker start %s: %w", name, err)
	}
	return nil
}

// Stop stops a running container.
func (c *Client) Stop(name string) error {
	log.Info().Str("name", name).Msg("stopping container")
	if err := c.cli.ContainerStop(context.Background(), name, container.StopOptions{}); err != nil {
		return fmt.Errorf("docker stop %s: %w", name, err)
	}
	return nil
}

// Pause pauses a running container (lightweight freeze).
func (c *Client) Pause(name string) error {
	log.Info().Str("name", name).Msg("pausing container")
	if err := c.cli.ContainerPause(context.Background(), name); err != nil {
		return fmt.Errorf("docker pause %s: %w", name, err)
	}
	return nil
}

// Unpause resumes a paused container.
func (c *Client) Unpause(name string) error {
	log.Info().Str("name", name).Msg("unpausing container")
	if err := c.cli.ContainerUnpause(context.Background(), name); err != nil {
		return fmt.Errorf("docker unpause %s: %w", name, err)
	}
	return nil
}

// Freeze pauses a container.
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
	if err := c.cli.ContainerRemove(context.Background(), name, types.ContainerRemoveOptions{Force: true}); err != nil {
		return fmt.Errorf("docker rm %s: %w", name, err)
	}
	return nil
}

// Status returns the status of a specific container.
// Returns ContainerInfo with Status="not_found" if the container does not exist.
func (c *Client) Status(name string) (*ContainerInfo, error) {
	info, err := c.cli.ContainerInspect(context.Background(), name)
	if err != nil {
		if dockerclient.IsErrNotFound(err) {
			return &ContainerInfo{Name: name, Status: "not_found"}, nil
		}
		return nil, fmt.Errorf("docker inspect %s: %w", name, err)
	}

	status := "unknown"
	if info.State != nil {
		status = info.State.Status
	}

	ip := c.extractIP(info)
	return &ContainerInfo{Name: name, Status: status, IP: ip}, nil
}

// GetIP returns the container's IP address on the configured network.
func (c *Client) GetIP(name string) (string, error) {
	info, err := c.cli.ContainerInspect(context.Background(), name)
	if err != nil {
		return "", fmt.Errorf("docker inspect %s: %w", name, err)
	}
	ip := c.extractIP(info)
	if ip == "" {
		return "", fmt.Errorf("container %s has no IP", name)
	}
	return ip, nil
}

// extractIP gets the container IP from inspect data.
func (c *Client) extractIP(info types.ContainerJSON) string {
	if info.NetworkSettings == nil || info.NetworkSettings.Networks == nil {
		return ""
	}
	if ep, ok := info.NetworkSettings.Networks[c.network]; ok && ep.IPAddress != "" {
		return ep.IPAddress
	}
	for _, ep := range info.NetworkSettings.Networks {
		if ep.IPAddress != "" {
			return ep.IPAddress
		}
	}
	return ""
}

// List returns all managed containers.
// The Freezer's own prefix filter handles per-type selection.
func (c *Client) List() ([]ContainerInfo, error) {
	containers, err := c.cli.ContainerList(context.Background(), types.ContainerListOptions{
		All: true,
	})
	if err != nil {
		return nil, fmt.Errorf("docker ps: %w", err)
	}

	var result []ContainerInfo
	for _, ct := range containers {
		name := ""
		if len(ct.Names) > 0 {
			name = strings.TrimPrefix(ct.Names[0], "/")
		}

		ip := ""
		if ct.State == "running" && ct.NetworkSettings != nil {
			if ep, ok := ct.NetworkSettings.Networks[c.network]; ok && ep.IPAddress != "" {
				ip = ep.IPAddress
			} else {
				for _, ep := range ct.NetworkSettings.Networks {
					if ep.IPAddress != "" {
						ip = ep.IPAddress
						break
					}
				}
			}
		}

		result = append(result, ContainerInfo{
			Name:   name,
			Status: ct.State,
			IP:     ip,
		})
	}
	return result, nil
}

// WaitForHealth polls the agent health endpoint until ready.
func (c *Client) WaitForHealth(ip string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	healthURL := fmt.Sprintf("http://%s:%d/healthz", ip, c.agentPort)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 --max-time 5 %s", healthURL)

	log.Debug().Str("url", healthURL).Dur("timeout", timeout).Msg("waiting for container health")

	for time.Now().Before(deadline) {
		out, err := c.RunSSH(curlCmd)
		if err == nil {
			code := strings.TrimSpace(strings.Trim(out, "'"))
			if code == "200" {
				log.Info().Str("url", healthURL).Str("status", code).Msg("container healthy")
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("container at %s not healthy after %s", ip, timeout)
}

// Exec runs a command inside a container via docker exec.
func (c *Client) Exec(containerName string, args ...string) (string, error) {
	ctx := context.Background()

	execCfg := types.ExecConfig{
		Cmd:          args,
		AttachStdout: true,
		AttachStderr: true,
	}

	resp, err := c.cli.ContainerExecCreate(ctx, containerName, execCfg)
	if err != nil {
		return "", fmt.Errorf("exec create %s: %w", containerName, err)
	}

	attach, err := c.cli.ContainerExecAttach(ctx, resp.ID, types.ExecStartCheck{})
	if err != nil {
		return "", fmt.Errorf("exec attach %s: %w", containerName, err)
	}
	defer attach.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, attach.Reader); err != nil {
		return "", fmt.Errorf("exec read %s: %w", containerName, err)
	}

	output := stripDockerStreamHeaders(buf.Bytes())
	return strings.TrimSpace(output), nil
}

// stripDockerStreamHeaders strips the 8-byte multiplexed stream headers
// from Docker exec output when TTY is not allocated.
func stripDockerStreamHeaders(data []byte) string {
	var result []byte
	for len(data) >= 8 {
		// Header: [stream_type(1), 0, 0, 0, size(4)]
		size := int(data[4])<<24 | int(data[5])<<16 | int(data[6])<<8 | int(data[7])
		data = data[8:]
		if size > len(data) {
			size = len(data)
		}
		result = append(result, data[:size]...)
		data = data[size:]
	}
	if len(result) == 0 {
		return string(data)
	}
	return string(result)
}

// ─── Memory Sync ───────────────────────────────────

const (
	containerWorkspace = "/home/agent/.jacoworks/workspace"
	containerSkillsDir = "/home/agent/.jacoworks/skills"
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

// PushMemoryFiles writes memory files into a container using the Docker SDK.
func (c *Client) PushMemoryFiles(containerName string, files map[string]string) error {
	if len(files) == 0 {
		return nil
	}

	c.Exec(containerName, "mkdir", "-p", containerWorkspace+"/memory")

	for canonical, content := range files {
		containerPath := canonicalToContainerPath(canonical)

		if err := c.copyFileToContainer(containerName, containerPath, []byte(content)); err != nil {
			log.Warn().Err(err).Str("file", canonical).Msg("push memory: copy failed")
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
	if content, err := c.readFileFromContainer(containerName, memPath); err == nil {
		content = strings.TrimSpace(content)
		if content != "" {
			files["MEMORY.md"] = content
		}
	}

	listCmd := fmt.Sprintf("ls -1 %s/memory/*.md 2>/dev/null", containerWorkspace)
	out, err := c.Exec(containerName, "sh", "-c", listCmd)
	if err == nil && strings.TrimSpace(out) != "" {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || !strings.HasSuffix(line, ".md") {
				continue
			}
			content, err := c.readFileFromContainer(containerName, line)
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

	c.Exec(containerName, "mkdir", "-p", containerSkillsDir)

	for relPath, content := range files {
		fullPath := containerSkillsDir + "/" + relPath
		dir := fullPath[:strings.LastIndex(fullPath, "/")]
		c.Exec(containerName, "mkdir", "-p", dir)

		if err := c.copyFileToContainer(containerName, fullPath, []byte(content)); err != nil {
			log.Warn().Err(err).Str("file", relPath).Msg("push skill: copy failed")
			continue
		}
	}

	log.Info().Str("container", containerName).Int("files", len(files)).Msg("skill files pushed")
	return nil
}

// copyFileToContainer copies a single file into a container using CopyToContainer.
func (c *Client) copyFileToContainer(containerName, filePath string, content []byte) error {
	ctx := context.Background()

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	hdr := &tar.Header{
		Name: filePath,
		Mode: 0644,
		Size: int64(len(content)),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		return fmt.Errorf("tar header: %w", err)
	}
	if _, err := tw.Write(content); err != nil {
		return fmt.Errorf("tar write: %w", err)
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("tar close: %w", err)
	}

	return c.cli.CopyToContainer(ctx, containerName, "/", &buf, types.CopyToContainerOptions{})
}

// readFileFromContainer reads a single file from a container using CopyFromContainer.
func (c *Client) readFileFromContainer(containerName, filePath string) (string, error) {
	ctx := context.Background()

	reader, _, err := c.cli.CopyFromContainer(ctx, containerName, filePath)
	if err != nil {
		return "", err
	}
	defer reader.Close()

	tr := tar.NewReader(reader)
	if _, err := tr.Next(); err != nil {
		return "", fmt.Errorf("tar read: %w", err)
	}

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, tr); err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return buf.String(), nil
}

// ContainerLogs returns the last N lines of stderr logs from a container.
func (c *Client) ContainerLogs(containerName string, lines int) (string, error) {
	if lines <= 0 || lines > 1000 {
		lines = 200
	}
	ctx := context.Background()
	reader, err := c.cli.ContainerLogs(ctx, containerName, types.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       fmt.Sprintf("%d", lines),
	})
	if err != nil {
		return "", fmt.Errorf("docker logs %s: %w", containerName, err)
	}
	defer reader.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, reader); err != nil {
		return "", fmt.Errorf("read logs %s: %w", containerName, err)
	}
	return stripDockerStreamHeaders(buf.Bytes()), nil
}

// WaitForHealthPort polls the agent health endpoint via host port mapping until ready.
func (c *Client) WaitForHealthPort(hostPort int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	healthURL := fmt.Sprintf("http://%s:%d/healthz", c.hostIP, hostPort)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 --max-time 5 %s", healthURL)

	log.Debug().Str("url", healthURL).Dur("timeout", timeout).Msg("waiting for container health")

	for time.Now().Before(deadline) {
		out, err := c.RunSSH(curlCmd)
		if err == nil {
			code := strings.TrimSpace(strings.Trim(out, "'"))
			if code == "200" {
				log.Info().Str("url", healthURL).Str("status", code).Msg("container healthy")
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("container at %s:%d not healthy after %s", c.hostIP, hostPort, timeout)
}

// ProvisionContainer creates a new container with env vars injected and waits for health.
func (c *Client) ProvisionContainer(name, containerToken string, envVars map[string]string, hostPort int) (string, error) {
	log.Info().Str("name", name).Str("image", c.image).Msg("provisioning container")

	allEnv := make(map[string]string, len(envVars)+1)
	for k, v := range envVars {
		allEnv[k] = v
	}
	allEnv["GATEWAY_TOKEN"] = containerToken

	if err := c.Create(name, allEnv, hostPort); err != nil {
		return "", fmt.Errorf("create: %w", err)
	}

	time.Sleep(3 * time.Second)

	ip, err := c.GetIP(name)
	if err != nil {
		return "", fmt.Errorf("get ip: %w", err)
	}

	if hostPort > 0 {
		if err := c.WaitForHealthPort(hostPort, 30*time.Second); err != nil {
			log.Warn().Err(err).Str("name", name).Msg("container started but health check failed")
		}
	} else {
		if err := c.WaitForHealth(ip, 30*time.Second); err != nil {
			log.Warn().Err(err).Str("name", name).Msg("container started but health check failed")
		}
	}

	log.Info().Str("name", name).Str("ip", ip).Msg("container provisioned")
	return ip, nil
}
