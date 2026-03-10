package docker

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	ocispec "github.com/opencontainers/image-spec/specs-go/v1"
)

// mockDockerClient implements the dockerAPI interface for testing.
type mockDockerClient struct {
	calls      []mockCall
	containers map[string]types.ContainerJSON
	listResult []types.Container
	createErr  error
	startErr   error
	stopErr    error
	pauseErr   error
	unpauseErr error
	removeErr  error
}

type mockCall struct {
	Method string
	Args   []string
}

func newMockDockerClient() *mockDockerClient {
	return &mockDockerClient{
		containers: make(map[string]types.ContainerJSON),
	}
}

func (m *mockDockerClient) record(method string, args ...string) {
	m.calls = append(m.calls, mockCall{Method: method, Args: args})
}

func (m *mockDockerClient) findCall(method string) (mockCall, bool) {
	for _, c := range m.calls {
		if c.Method == method {
			return c, true
		}
	}
	return mockCall{}, false
}

func (m *mockDockerClient) ContainerCreate(_ context.Context, config *container.Config, _ *container.HostConfig, _ *network.NetworkingConfig, _ *ocispec.Platform, containerName string) (container.CreateResponse, error) {
	m.record("ContainerCreate", containerName, config.Image)
	if m.createErr != nil {
		return container.CreateResponse{}, m.createErr
	}
	return container.CreateResponse{ID: "test-id-" + containerName}, nil
}

func (m *mockDockerClient) ContainerStart(_ context.Context, containerID string, _ types.ContainerStartOptions) error {
	m.record("ContainerStart", containerID)
	return m.startErr
}

func (m *mockDockerClient) ContainerStop(_ context.Context, containerID string, _ container.StopOptions) error {
	m.record("ContainerStop", containerID)
	return m.stopErr
}

func (m *mockDockerClient) ContainerPause(_ context.Context, containerID string) error {
	m.record("ContainerPause", containerID)
	return m.pauseErr
}

func (m *mockDockerClient) ContainerUnpause(_ context.Context, containerID string) error {
	m.record("ContainerUnpause", containerID)
	return m.unpauseErr
}

func (m *mockDockerClient) ContainerRemove(_ context.Context, containerID string, options types.ContainerRemoveOptions) error {
	m.record("ContainerRemove", containerID)
	if options.Force {
		m.calls[len(m.calls)-1].Args = append(m.calls[len(m.calls)-1].Args, "-f")
	}
	return m.removeErr
}

func (m *mockDockerClient) ContainerInspect(_ context.Context, containerID string) (types.ContainerJSON, error) {
	m.record("ContainerInspect", containerID)
	if info, ok := m.containers[containerID]; ok {
		return info, nil
	}
	return types.ContainerJSON{}, containerNotFoundError{containerID}
}

func (m *mockDockerClient) ContainerList(_ context.Context, _ types.ContainerListOptions) ([]types.Container, error) {
	m.record("ContainerList")
	return m.listResult, nil
}

func (m *mockDockerClient) ContainerExecCreate(_ context.Context, _ string, _ types.ExecConfig) (types.IDResponse, error) {
	return types.IDResponse{}, nil
}

func (m *mockDockerClient) ContainerExecAttach(_ context.Context, _ string, _ types.ExecStartCheck) (types.HijackedResponse, error) {
	return types.HijackedResponse{}, nil
}

func (m *mockDockerClient) ContainerExecInspect(_ context.Context, _ string) (types.ContainerExecInspect, error) {
	return types.ContainerExecInspect{}, nil
}

func (m *mockDockerClient) ContainerLogs(_ context.Context, _ string, _ types.ContainerLogsOptions) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (m *mockDockerClient) CopyToContainer(_ context.Context, _, _ string, _ io.Reader, _ types.CopyToContainerOptions) error {
	return nil
}

func (m *mockDockerClient) CopyFromContainer(_ context.Context, _, _ string) (io.ReadCloser, types.ContainerPathStat, error) {
	return io.NopCloser(strings.NewReader("")), types.ContainerPathStat{}, nil
}

// containerNotFoundError satisfies dockerclient.IsErrNotFound.
type containerNotFoundError struct {
	id string
}

func (e containerNotFoundError) Error() string { return "No such container: " + e.id }
func (e containerNotFoundError) NotFound()     {}

// Compile-time assertion that mock satisfies the interface.
var _ dockerAPI = (*mockDockerClient)(nil)

func newTestClient(mock *mockDockerClient) *Client {
	return &Client{
		sshTarget: "opc@10.0.1.3",
		image:     "jacoworks/vm-agent:latest",
		network:   "agent-net",
		agentPort: 18789,
		hostIP:    "10.0.1.3",
		cli:       mock,
	}
}

func TestCreate(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	envVars := map[string]string{
		"LLM_PROXY_URL": "http://proxy:8317",
		"LLM_PROXY_KEY": "sk-test",
	}

	if err := c.Create("agent-user1", "user-test-id", envVars, 0); err != nil {
		t.Fatalf("Create: %v", err)
	}

	call, found := m.findCall("ContainerCreate")
	if !found {
		t.Fatal("expected ContainerCreate call")
	}
	if call.Args[0] != "agent-user1" {
		t.Errorf("container name = %q, want agent-user1", call.Args[0])
	}
	if call.Args[1] != "jacoworks/vm-agent:latest" {
		t.Errorf("image = %q, want jacoworks/vm-agent:latest", call.Args[1])
	}

	_, startFound := m.findCall("ContainerStart")
	if !startFound {
		t.Fatal("expected ContainerStart call after Create")
	}
}

func TestStart(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	if err := c.Start("agent-user1"); err != nil {
		t.Fatalf("Start: %v", err)
	}

	call, found := m.findCall("ContainerStart")
	if !found {
		t.Fatal("expected ContainerStart call")
	}
	if call.Args[0] != "agent-user1" {
		t.Errorf("container = %q, want agent-user1", call.Args[0])
	}
}

func TestStop(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	if err := c.Stop("agent-user1"); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	_, found := m.findCall("ContainerStop")
	if !found {
		t.Fatal("expected ContainerStop call")
	}
}

func TestPause(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	if err := c.Pause("agent-user1"); err != nil {
		t.Fatalf("Pause: %v", err)
	}

	_, found := m.findCall("ContainerPause")
	if !found {
		t.Fatal("expected ContainerPause call")
	}
}

func TestUnpause(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	if err := c.Unpause("agent-user1"); err != nil {
		t.Fatalf("Unpause: %v", err)
	}

	_, found := m.findCall("ContainerUnpause")
	if !found {
		t.Fatal("expected ContainerUnpause call")
	}
}

func TestDestroy(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	if err := c.Destroy("agent-user1"); err != nil {
		t.Fatalf("Destroy: %v", err)
	}

	call, found := m.findCall("ContainerRemove")
	if !found {
		t.Fatal("expected ContainerRemove call")
	}
	hasForce := false
	for _, a := range call.Args {
		if a == "-f" {
			hasForce = true
		}
	}
	if !hasForce {
		t.Errorf("expected force flag in remove")
	}
}

func TestStatus(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	m.containers["agent-user1"] = types.ContainerJSON{
		ContainerJSONBase: &types.ContainerJSONBase{
			State: &types.ContainerState{
				Status: "running",
			},
		},
		NetworkSettings: &types.NetworkSettings{
			Networks: map[string]*network.EndpointSettings{
				"agent-net": {IPAddress: "172.18.0.5"},
			},
		},
	}

	info, err := c.Status("agent-user1")
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if info.Name != "agent-user1" {
		t.Errorf("Name = %q, want agent-user1", info.Name)
	}
	if info.Status != "running" {
		t.Errorf("Status = %q, want running", info.Status)
	}
	if info.IP != "172.18.0.5" {
		t.Errorf("IP = %q, want 172.18.0.5", info.IP)
	}
}

func TestStatusNotFound(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	info, err := c.Status("agent-nonexist")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if info.Status != "not_found" {
		t.Errorf("status = %q, want 'not_found'", info.Status)
	}
	if info.Name != "agent-nonexist" {
		t.Errorf("name = %q, want 'agent-nonexist'", info.Name)
	}
}

func TestGetIP(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	m.containers["agent-user1"] = types.ContainerJSON{
		ContainerJSONBase: &types.ContainerJSONBase{},
		NetworkSettings: &types.NetworkSettings{
			Networks: map[string]*network.EndpointSettings{
				"agent-net": {IPAddress: "10.20.20.5"},
			},
		},
	}

	ip, err := c.GetIP("agent-user1")
	if err != nil {
		t.Fatalf("GetIP: %v", err)
	}
	if ip != "10.20.20.5" {
		t.Errorf("IP = %q, want 10.20.20.5", ip)
	}
}

func TestList(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	m.listResult = []types.Container{
		{
			Names: []string{"/agent-user1"},
			State: "running",
			NetworkSettings: &types.SummaryNetworkSettings{
				Networks: map[string]*network.EndpointSettings{
					"agent-net": {IPAddress: "172.18.0.5"},
				},
			},
		},
		{
			Names: []string{"/agent-user2"},
			State: "paused",
		},
	}

	list, err := c.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("len = %d, want 2", len(list))
	}
	if list[0].Name != "agent-user1" {
		t.Errorf("first container = %q", list[0].Name)
	}
	if list[1].Status != "paused" {
		t.Errorf("second status = %q, want paused", list[1].Status)
	}
}

func TestCreateError(t *testing.T) {
	m := newMockDockerClient()
	c := newTestClient(m)

	m.createErr = containerNotFoundError{"already exists"}

	err := c.Create("agent-user1", "", nil, 0)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "docker run") {
		t.Errorf("error = %q, want docker run context", err.Error())
	}
}

func TestCanonicalToContainerPath(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"MEMORY.md", "/home/agent/.jacoworks/workspace/MEMORY.md"},
		{"daily/2026-02-26.md", "/home/agent/.jacoworks/workspace/memory/2026-02-26.md"},
		{"notes.md", "/home/agent/.jacoworks/workspace/notes.md"},
	}
	for _, tt := range tests {
		got := canonicalToContainerPath(tt.input)
		if got != tt.want {
			t.Errorf("canonicalToContainerPath(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestContainerToCanonicalPath(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"/home/agent/.jacoworks/workspace/MEMORY.md", "MEMORY.md"},
		{"/home/agent/.jacoworks/workspace/memory/2026-02-26.md", "daily/2026-02-26.md"},
	}
	for _, tt := range tests {
		got := containerToCanonicalPath(tt.input)
		if got != tt.want {
			t.Errorf("containerToCanonicalPath(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
