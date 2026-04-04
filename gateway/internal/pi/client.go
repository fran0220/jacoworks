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
	ErrTemplatesDirNotFound = errors.New("openclaw templates directory not found")
	ErrTemplateNotFound     = errors.New("openclaw template not found")
	ErrProfileNotFound      = errors.New("profile not found")
	ErrPiMigrationPending   = errors.New("legacy OpenClaw flow removed; Pi CLI migration pending")
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

type TemplateAgentSummary struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	IsLeader bool   `json:"isLeader"`
}

type TemplateSummary struct {
	Type        string                 `json:"type"`
	Name        string                 `json:"name"`
	DisplayName string                 `json:"displayName"`
	Description string                 `json:"description"`
	Version     string                 `json:"version"`
	Agents      []TemplateAgentSummary `json:"agents"`
}

type TemplateDetail struct {
	Type        string                 `json:"type"`
	Name        string                 `json:"name"`
	DisplayName string                 `json:"displayName"`
	Description string                 `json:"description"`
	Version     string                 `json:"version"`
	Agents      []TemplateAgentSummary `json:"agents"`
	Files       map[string]string      `json:"files,omitempty"`
}

type TemplateInstallResult struct {
	Template      string `json:"template"`
	Container     string `json:"container"`
	Workspace     string `json:"workspace"`
	Agents        int    `json:"agents"`
	FilesCopied   int    `json:"filesCopied"`
	ConfigChanged bool   `json:"configChanged"`
}

type ProfileSummary struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	Icon        string `json:"icon,omitempty"`
	SessionKey  string `json:"sessionKey"`
}

type ProfileDetail struct {
	Type        string            `json:"type"`
	Name        string            `json:"name"`
	DisplayName string            `json:"displayName"`
	Description string            `json:"description"`
	Icon        string            `json:"icon,omitempty"`
	Model       string            `json:"model"`
	Skills      []string          `json:"skills,omitempty"`
	Workspace   string            `json:"workspace,omitempty"`
	Files       map[string]string `json:"files,omitempty"`
}

func NewClient(rt container.Runtime, _ string, hostIP, image string, getLLM func() config.LLMConfig, s *store.Store, gatewayURL string) *Client {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}
	if image == "" {
		image = "openclaw-ready"
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

func (c *Client) LegacyProtocolDisabled() bool {
	return true
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
		ContainerType:  store.ContainerTypeOpenClaw,
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
	if err := c.configWriter.WritePiConfig(ctx, info.ContainerName, info.ContainerToken); err != nil {
		return false, err
	}
	return true, nil
}

func (c *Client) SyncAllVMs(ctx context.Context) error {
	if c == nil || c.store == nil {
		return nil
	}
	containers, err := c.store.ListContainersByType(ctx, store.ContainerTypeOpenClaw)
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

func (c *Client) ListTemplates() ([]TemplateSummary, error) {
	return []TemplateSummary{}, nil
}

func (c *Client) GetTemplateSummary(string) (*TemplateSummary, error) {
	return nil, ErrTemplateNotFound
}

func (c *Client) GetTemplateDetail(string) (*TemplateDetail, error) {
	return nil, ErrTemplateNotFound
}

func (c *Client) SaveTemplate(*TemplateDetail) error {
	return ErrPiMigrationPending
}

func (c *Client) DeleteTemplate(string) error {
	return ErrPiMigrationPending
}

func (c *Client) InstallTemplate(context.Context, *store.ContainerInfo, string) (*TemplateInstallResult, error) {
	return nil, ErrPiMigrationPending
}

func (c *Client) ListProfilesMerged(string) []ProfileSummary {
	return []ProfileSummary{}
}

func (c *Client) UserGetProfileDetail(string, string) (*ProfileDetail, error) {
	return nil, ErrProfileNotFound
}

func GetProfileDetail(string) (*ProfileDetail, error) {
	return nil, ErrProfileNotFound
}

func (c *Client) UserSaveProfile(string, *ProfileDetail) error {
	return ErrPiMigrationPending
}

func (c *Client) UserDeleteProfile(string, string) error {
	return ErrPiMigrationPending
}

func (c *Client) DeployProfiles(string) (int, error) {
	return 0, nil
}

func (c *Client) DeployUserProfiles(string, string) (int, error) {
	return 0, nil
}

func (c *Client) IsJMOSInstalled(string) bool {
	return false
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
		_ = c.store.UpdateContainerIP(ctx, updated.UserID, store.ContainerTypeOpenClaw, updated.ContainerIP)
	}
	return &updated, nil
}
