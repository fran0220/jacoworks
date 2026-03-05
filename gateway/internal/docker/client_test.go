package docker

import (
	"fmt"
	"strings"
	"testing"
)

// mockRunner records commands for verification without executing them.
type mockRunner struct {
	calls   []mockCall
	results map[string]mockResult // key pattern → result
}

type mockCall struct {
	Name string
	Args []string
}

type mockResult struct {
	Output string
	Err    error
}

func newMockRunner() *mockRunner {
	return &mockRunner{
		results: make(map[string]mockResult),
	}
}

func (m *mockRunner) Run(name string, args ...string) (string, error) {
	m.calls = append(m.calls, mockCall{Name: name, Args: args})

	// Match by command key: "name args[0] args[1]..."
	key := name + " " + strings.Join(args, " ")
	for pattern, result := range m.results {
		if strings.Contains(key, pattern) {
			return result.Output, result.Err
		}
	}
	return "", nil
}

func (m *mockRunner) On(pattern string, output string, err error) {
	m.results[pattern] = mockResult{Output: output, Err: err}
}

func (m *mockRunner) lastCall() mockCall {
	if len(m.calls) == 0 {
		return mockCall{}
	}
	return m.calls[len(m.calls)-1]
}

func (m *mockRunner) findCall(substr string) (mockCall, bool) {
	for _, c := range m.calls {
		full := c.Name + " " + strings.Join(c.Args, " ")
		if strings.Contains(full, substr) {
			return c, true
		}
	}
	return mockCall{}, false
}

func newTestClient(runner *mockRunner) *Client {
	c := NewClient("opc@10.0.1.3", "jacoworks/vm-agent:latest", "agent-net", 18789, "10.0.1.3")
	c.runner = runner
	return c
}

func TestCreate(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	envVars := map[string]string{
		"LLM_PROXY_URL": "http://proxy:8317",
		"LLM_PROXY_KEY": "sk-test",
	}

	if err := c.Create("agent-user1", envVars, 0); err != nil {
		t.Fatalf("Create: %v", err)
	}

	call, found := m.findCall("docker run")
	if !found {
		t.Fatal("expected docker run command")
	}

	args := strings.Join(call.Args, " ")
	if !strings.Contains(args, "--name agent-user1") {
		t.Errorf("missing --name, got: %s", args)
	}
	if !strings.Contains(args, "--network agent-net") {
		t.Errorf("missing --network, got: %s", args)
	}
	if !strings.Contains(args, "jacoworks/vm-agent:latest") {
		t.Errorf("missing image, got: %s", args)
	}
	if !strings.Contains(args, "LLM_PROXY_URL=http://proxy:8317") {
		t.Errorf("missing LLM_PROXY_URL env, got: %s", args)
	}
}

func TestStart(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	if err := c.Start("agent-user1"); err != nil {
		t.Fatalf("Start: %v", err)
	}

	call, found := m.findCall("docker start")
	if !found {
		t.Fatal("expected docker start command")
	}
	if !strings.Contains(strings.Join(call.Args, " "), "agent-user1") {
		t.Errorf("missing container name in start")
	}
}

func TestStop(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	if err := c.Stop("agent-user1"); err != nil {
		t.Fatalf("Stop: %v", err)
	}

	_, found := m.findCall("docker stop")
	if !found {
		t.Fatal("expected docker stop command")
	}
}

func TestPause(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	if err := c.Pause("agent-user1"); err != nil {
		t.Fatalf("Pause: %v", err)
	}

	_, found := m.findCall("docker pause")
	if !found {
		t.Fatal("expected docker pause command")
	}
}

func TestUnpause(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	if err := c.Unpause("agent-user1"); err != nil {
		t.Fatalf("Unpause: %v", err)
	}

	_, found := m.findCall("docker unpause")
	if !found {
		t.Fatal("expected docker unpause command")
	}
}

func TestDestroy(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	if err := c.Destroy("agent-user1"); err != nil {
		t.Fatalf("Destroy: %v", err)
	}

	call, found := m.findCall("docker rm")
	if !found {
		t.Fatal("expected docker rm command")
	}
	args := strings.Join(call.Args, " ")
	if !strings.Contains(args, "-f") {
		t.Errorf("expected force flag, got: %s", args)
	}
}

func TestStatus(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	psJSON := `{"Names":"agent-user1","State":"running","Status":"Up 2 hours"}`
	inspectJSON := `[{"NetworkSettings":{"Networks":{"agent-net":{"IPAddress":"172.18.0.5"}}}}]`
	m.On("docker ps", psJSON, nil)
	m.On("docker inspect", inspectJSON, nil)

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
	m := newMockRunner()
	c := newTestClient(m)

	m.On("docker ps", "", nil)

	_, err := c.Status("agent-nonexist")
	if err == nil {
		t.Fatal("expected error for missing container")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err.Error())
	}
}

func TestGetIP(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	inspectJSON := `[{"NetworkSettings":{"Networks":{"agent-net":{"IPAddress":"10.20.20.5"}}}}]`
	m.On("docker inspect", inspectJSON, nil)

	ip, err := c.GetIP("agent-user1")
	if err != nil {
		t.Fatalf("GetIP: %v", err)
	}
	if ip != "10.20.20.5" {
		t.Errorf("IP = %q, want 10.20.20.5", ip)
	}
}

func TestList(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	psOut := `{"Names":"agent-user1","State":"running","Status":"Up 2 hours"}
{"Names":"agent-user2","State":"paused","Status":"Up 1 hour (Paused)"}`
	m.On("docker ps", psOut, nil)
	m.On("docker inspect", `[{"NetworkSettings":{"Networks":{"agent-net":{"IPAddress":"172.18.0.5"}}}}]`, nil)

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
	m := newMockRunner()
	c := newTestClient(m)

	m.On("docker run", "Error: name already in use", fmt.Errorf("exit 125"))

	err := c.Create("agent-user1", nil, 0)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "docker run") {
		t.Errorf("error = %q, want docker run context", err.Error())
	}
}

func TestSSHCommandFormat(t *testing.T) {
	m := newMockRunner()
	c := newTestClient(m)

	c.docker("ps", "-a")

	call := m.lastCall()
	if call.Name != "ssh" {
		t.Fatalf("expected ssh command, got %q", call.Name)
	}
	args := strings.Join(call.Args, " ")
	if !strings.Contains(args, "-o StrictHostKeyChecking=no") {
		t.Errorf("missing StrictHostKeyChecking=no, got: %s", args)
	}
	if !strings.Contains(args, "opc@10.0.1.3") {
		t.Errorf("missing SSH target, got: %s", args)
	}
	if !strings.Contains(args, "docker ps -a") {
		t.Errorf("missing docker command, got: %s", args)
	}
}

func TestLocalClient(t *testing.T) {
	m := newMockRunner()
	c := NewClient("local", "jacoworks/vm-agent:latest", "agent-net", 18789, "")
	c.runner = m

	c.docker("ps")

	call := m.lastCall()
	if call.Name != "docker" {
		t.Fatalf("local client should call docker directly, got %q", call.Name)
	}
}

func TestCanonicalToContainerPath(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"MEMORY.md", "/home/agent/.openclaw/workspace/MEMORY.md"},
		{"daily/2026-02-26.md", "/home/agent/.openclaw/workspace/memory/2026-02-26.md"},
		{"notes.md", "/home/agent/.openclaw/workspace/notes.md"},
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
		{"/home/agent/.openclaw/workspace/MEMORY.md", "MEMORY.md"},
		{"/home/agent/.openclaw/workspace/memory/2026-02-26.md", "daily/2026-02-26.md"},
	}
	for _, tt := range tests {
		got := containerToCanonicalPath(tt.input)
		if got != tt.want {
			t.Errorf("containerToCanonicalPath(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}
