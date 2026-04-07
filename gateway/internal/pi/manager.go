package pi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/container"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	piWrapperServiceName   = "pi-ws-wrapper.service"
	piWrapperHealthTimeout = 60 * time.Second
	piWrapperWarmupTimeout = 3 * time.Second
)

type Manager struct {
	rt   container.Runtime
	port int
}

func NewManager(rt container.Runtime, port int) *Manager {
	if port <= 0 {
		port = defaultGatewayPort
	}
	return &Manager{rt: rt, port: port}
}

func (m *Manager) EnsurePiWrapper(ctx context.Context, info *store.ContainerInfo) error {
	if m == nil || m.rt == nil {
		return ErrPiMigrationPending
	}
	ip := strings.TrimSpace(info.ContainerIP)
	if ip == "" {
		return fmt.Errorf("pi wrapper address unavailable")
	}
	healthURL := fmt.Sprintf("http://%s:%d/health", ip, m.port)
	if err := m.rt.WaitForHealth(ctx, info.ContainerName, healthURL, piWrapperWarmupTimeout); err == nil {
		return nil
	}
	return m.RestartPiWrapper(ctx, info)
}

func (m *Manager) RestartPiWrapper(ctx context.Context, info *store.ContainerInfo) error {
	if m == nil || m.rt == nil {
		return ErrPiMigrationPending
	}
	ip := strings.TrimSpace(info.ContainerIP)
	if ip == "" {
		return fmt.Errorf("pi wrapper address unavailable")
	}
	if err := m.restartService(ctx, info.ContainerName); err != nil {
		return err
	}
	return m.rt.WaitForHealth(ctx, info.ContainerName, fmt.Sprintf("http://%s:%d/health", ip, m.port), piWrapperHealthTimeout)
}

func (m *Manager) restartService(ctx context.Context, containerName string) error {
	if _, err := m.rt.Exec(ctx, containerName, "systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("reload pi wrapper unit: %w", err)
	}
	if _, err := m.rt.Exec(ctx, containerName, "systemctl", "reset-failed", piWrapperServiceName); err != nil {
		return fmt.Errorf("reset pi wrapper unit: %w", err)
	}
	if _, err := m.rt.Exec(ctx, containerName, "systemctl", "restart", piWrapperServiceName); err != nil {
		return fmt.Errorf("restart pi wrapper unit: %w", err)
	}
	return nil
}
