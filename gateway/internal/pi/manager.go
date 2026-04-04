package pi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/container"
	"github.com/fran0220/jacoworks/gateway/internal/store"
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
	return m.rt.WaitForHealth(ctx, info.ContainerName, fmt.Sprintf("http://%s:%d/health", ip, m.port), 60*time.Second)
}
