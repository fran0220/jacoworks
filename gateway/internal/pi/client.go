package pi

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/container"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

var (
	ErrPiMigrationPending = errors.New("legacy OpenClaw flow removed; Pi CLI migration pending")
)

const defaultGatewayPort = 18789

type Client struct {
	rt           container.Runtime
	hostIP       string
	image        string
	store        *store.Store
	configWriter *ConfigWriter
	manager      *Manager
}

func NewClient(rt container.Runtime, _ string, hostIP, image string, getLLM func() config.LLMConfig, s *store.Store, gatewayURL string) *Client {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}
	if image == "" {
		image = "pi-ready"
	}
	return &Client{
		rt:           rt,
		hostIP:       hostIP,
		image:        image,
		store:        s,
		configWriter: NewConfigWriter(rt, getLLM, gatewayURL),
		manager:      NewManager(rt, defaultGatewayPort),
	}
}

func (c *Client) Runtime() container.Runtime {
	return c.rt
}

func (c *Client) HostIP() string {
	return c.hostIP
}

func (c *Client) UpstreamAddr(info *store.ContainerInfo) string {
	host := strings.TrimSpace(info.ContainerIP)
	if host == "" {
		host = c.hostIP
	}
	q := url.Values{}
	if token := strings.TrimSpace(info.ContainerToken); token != "" {
		q.Set("token", token)
	}
	return fmt.Sprintf("ws://%s:%d/ws?%s", host, defaultGatewayPort, q.Encode())
}

func (c *Client) EnsureRunning(ctx context.Context, info *store.ContainerInfo) error {
	if c == nil || c.rt == nil {
		return ErrPiMigrationPending
	}
	updated, err := c.ensureInstanceReady(ctx, info)
	if err != nil {
		return err
	}
	if err := c.configWriter.WritePiConfig(ctx, updated.ContainerName, updated.ContainerToken); err != nil {
		return err
	}
	return c.manager.EnsurePiWrapper(ctx, updated)
}

func (c *Client) Provision(containerName, userID, containerToken string, _ int, _ int) (string, error) {
	if c == nil || c.rt == nil {
		return "", ErrPiMigrationPending
	}
	ctx := context.Background()
	info := &store.ContainerInfo{
		UserID:         userID,
		ContainerName:  containerName,
		ContainerToken: containerToken,
		ContainerType:  store.ContainerTypePiVM,
	}
	status, err := c.rt.Status(ctx, containerName)
	if err != nil {
		return "", err
	}
	if status != nil && status.Status == "not_found" {
		if err := c.rt.Create(ctx, container.InstanceSpec{
			Name:     containerName,
			Image:    c.image,
			MemoryMB: 4096,
			CPUs:     4,
		}); err != nil {
			return "", err
		}
	} else {
		if _, err := c.ensureInstanceReady(ctx, info); err != nil {
			return "", err
		}
	}

	updated, err := c.ensureInstanceReady(ctx, info)
	if err != nil {
		return "", err
	}
	if err := c.configWriter.WritePiConfig(ctx, updated.ContainerName, containerToken); err != nil {
		return "", err
	}
	if err := c.manager.EnsurePiWrapper(ctx, updated); err != nil {
		return "", err
	}
	return updated.ContainerIP, nil
}

func (c *Client) SyncConfig(ctx context.Context, info *store.ContainerInfo) (bool, error) {
	if c == nil || c.rt == nil {
		return false, ErrPiMigrationPending
	}
	updated, err := c.ensureInstanceReady(ctx, info)
	if err != nil {
		return false, err
	}
	if err := c.configWriter.WritePiConfig(ctx, updated.ContainerName, updated.ContainerToken); err != nil {
		return false, err
	}
	if err := c.manager.RestartPiWrapper(ctx, updated); err != nil {
		return false, err
	}
	return true, nil
}

func (c *Client) SyncAllVMs(ctx context.Context) error {
	if c == nil || c.store == nil {
		return nil
	}
	containers, err := c.store.ListContainersByType(ctx, store.ContainerTypePiVM)
	if err != nil {
		return err
	}
	for _, info := range containers {
		if info == nil || info.Status != "running" {
			continue
		}
		if _, err := c.SyncConfig(ctx, info); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) ensureInstanceReady(ctx context.Context, info *store.ContainerInfo) (*store.ContainerInfo, error) {
	status, err := c.rt.Status(ctx, info.ContainerName)
	if err != nil {
		return nil, err
	}
	if status == nil || status.Status == "not_found" {
		return nil, fmt.Errorf("container not found: %s", info.ContainerName)
	}

	switch status.Status {
	case "running":
	case "paused":
		if err := c.rt.Unfreeze(ctx, info.ContainerName); err != nil {
			return nil, err
		}
	default:
		if err := c.rt.Start(ctx, info.ContainerName); err != nil {
			return nil, err
		}
	}

	status, err = c.rt.Status(ctx, info.ContainerName)
	if err != nil {
		return nil, err
	}
	if status == nil || strings.TrimSpace(status.IP) == "" {
		return nil, fmt.Errorf("container IP unavailable: %s", info.ContainerName)
	}

	updated := *info
	updated.ContainerIP = status.IP
	updated.Status = "running"
	if c.store != nil && strings.TrimSpace(updated.UserID) != "" {
		_ = c.store.UpdateContainerIP(ctx, updated.UserID, store.ContainerTypePiVM, updated.ContainerIP)
	}
	return &updated, nil
}
