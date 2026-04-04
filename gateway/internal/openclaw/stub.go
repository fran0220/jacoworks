package openclaw

import (
	"context"
	"errors"
	"fmt"

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

// Client is a migration-period facade that keeps the remaining Incus-backed
// infrastructure compiling while the legacy OpenClaw protocol layer is removed.
type Client struct {
	rt     container.Runtime
	hostIP string
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

func NewClient(rt container.Runtime, _ string, hostIP, _ string, _ func() config.LLMConfig, _ *store.Store) *Client {
	if hostIP == "" {
		hostIP = "127.0.0.1"
	}
	return &Client{rt: rt, hostIP: hostIP}
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
	port := info.HostPort
	if port <= 0 {
		port = defaultGatewayPort
	}
	return fmt.Sprintf("ws://%s:%d/ws", info.ContainerIP, port)
}

func (c *Client) EnsureRunning(ctx context.Context, info *store.ContainerInfo) error {
	if c == nil || c.rt == nil {
		return ErrPiMigrationPending
	}
	status, err := c.rt.Status(ctx, info.ContainerName)
	if err != nil {
		return err
	}
	if status == nil {
		return nil
	}
	switch status.Status {
	case "running":
		return nil
	case "paused":
		return c.rt.Unfreeze(ctx, info.ContainerName)
	default:
		return c.rt.Start(ctx, info.ContainerName)
	}
}

func (c *Client) Provision(string, string, string, int, int) (string, error) {
	return "", ErrPiMigrationPending
}

func (c *Client) SyncConfig(context.Context, *store.ContainerInfo) (bool, error) {
	return false, ErrPiMigrationPending
}

func (c *Client) SyncAllVMs(context.Context) error {
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
