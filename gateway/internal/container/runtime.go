package container

import (
	"context"
	"time"
)

// InstanceSpec describes a new container to create.
type InstanceSpec struct {
	Name          string
	Image         string            // container image alias
	Env           map[string]string // environment variables
	Labels        map[string]string
	HostPort      int         // port to expose on host (mapped to ContainerPort)
	ContainerPort int         // port inside the container (default 18789)
	BindMounts    []BindMount // host→container directory mounts
	User          string      // user to run as (e.g. "root")
	MemoryMB      int         // memory limit in MB (0 = no limit)
	CPUs          int         // CPU limit (0 = no limit)
	HealthCmd     string      // health check command (optional)
}

// BindMount maps a host directory to a container path.
type BindMount struct {
	Source string // host path
	Target string // container path
}

// ContainerInfo represents a container's basic status.
type ContainerInfo struct {
	Name   string
	Status string // "running", "paused", "exited", "not_found"
	IP     string
}

// ExecResult contains the result of a command executed inside a container.
type ExecResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// Runtime is the backend-neutral container management interface.
// Implemented by the Incus backend.
type Runtime interface {
	// Lifecycle
	Create(ctx context.Context, spec InstanceSpec) error
	Start(ctx context.Context, name string) error
	Stop(ctx context.Context, name string) error
	Restart(ctx context.Context, name string) error
	Freeze(ctx context.Context, name string) error
	Unfreeze(ctx context.Context, name string) error
	Unpause(ctx context.Context, name string) error
	Remove(ctx context.Context, name string) error

	// Status
	Status(ctx context.Context, name string) (*ContainerInfo, error)
	List(ctx context.Context) ([]ContainerInfo, error)

	// Exec
	Exec(ctx context.Context, name string, cmd ...string) (*ExecResult, error)

	// File operations
	WriteFile(ctx context.Context, name, path string, content []byte) error
	ReadFile(ctx context.Context, name, path string) (string, error)

	// Logs
	Logs(ctx context.Context, name string, lines int) (string, error)

	// Health
	WaitForHealth(ctx context.Context, name, healthURL string, timeout time.Duration) error
}
