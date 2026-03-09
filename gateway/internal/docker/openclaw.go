package docker

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/go-connections/nat"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
)

// OpenClawClient wraps a docker Client for OpenClaw-specific container operations.
type OpenClawClient struct {
	client   *Client
	dataRoot string
	getLLM   func() config.LLMConfig
	store    *store.Store
}

const (
	jaMOSSContainerRoot  = "/opt/jamoss"
	jaMOSSStartScript    = jaMOSSContainerRoot + "/start-jamoss.sh"
	jaMOSSHealthEndpoint = "http://127.0.0.1:6565/api/health"
)

var (
	ErrTemplatesDirNotFound = errors.New("openclaw templates directory not found")
	ErrTemplateNotFound     = errors.New("openclaw template not found")
)

type TemplateSummary struct {
	Name        string                 `json:"name"`
	DisplayName string                 `json:"displayName"`
	Description string                 `json:"description"`
	Version     string                 `json:"version"`
	Agents      []TemplateAgentSummary `json:"agents"`
}

type TemplateAgentSummary struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	IsLeader bool   `json:"isLeader"`
}

type TemplateInstallResult struct {
	Template      string `json:"template"`
	Container     string `json:"container"`
	Workspace     string `json:"workspace"`
	Agents        int    `json:"agents"`
	FilesCopied   int    `json:"filesCopied"`
	ConfigChanged bool   `json:"configChanged"`
}

type openclawTemplateManifest struct {
	Name        string                        `json:"name"`
	DisplayName string                        `json:"displayName"`
	Description string                        `json:"description"`
	Version     string                        `json:"version"`
	Agents      []openclawTemplateAgent       `json:"agents"`
	Workspace   openclawTemplateWorkspaceSpec `json:"workspace"`
}

type openclawTemplateAgent struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Role     string          `json:"role"`
	Prompt   string          `json:"prompt"`
	Skills   []string        `json:"skills"`
	Model    string          `json:"model"`
	IsLeader bool            `json:"isLeader"`
	Cron     json.RawMessage `json:"cron"`
}

type openclawTemplateWorkspaceSpec struct {
	SharedRoot string            `json:"sharedRoot"`
	Files      map[string]string `json:"files"`
}

// NewOpenClawClient creates a new OpenClawClient.
func NewOpenClawClient(client *Client, dataRoot string, getLLM func() config.LLMConfig, s *store.Store) *OpenClawClient {
	return &OpenClawClient{
		client:   client,
		dataRoot: dataRoot,
		getLLM:   getLLM,
		store:    s,
	}
}

// DockerClient returns the underlying Docker client for direct container operations.
func (oc *OpenClawClient) DockerClient() *Client {
	return oc.client
}

func (m *openclawTemplateManifest) teamID() string {
	if m.Name != "" {
		return m.Name
	}
	return "team"
}

func (m *openclawTemplateManifest) workspaceRoot() string {
	root := m.Workspace.SharedRoot
	if root == "" {
		root = "/data/teams/{team_id}"
	}
	return strings.ReplaceAll(root, "{team_id}", m.teamID())
}

func normalizeTemplateRelativePath(p string) (string, error) {
	p = strings.TrimSpace(strings.ReplaceAll(p, "\\", "/"))
	if p == "" {
		return "", fmt.Errorf("empty relative path")
	}
	clean := path.Clean(p)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("invalid relative path: %q", p)
	}
	return clean, nil
}

func resolveTemplatesDir() (string, error) {
	candidates := make([]string, 0, 8)
	for _, key := range []string{"GATEWAY_OPENCLAW_TEMPLATES_DIR", "OPENCLAW_TEMPLATES_DIR"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			candidates = append(candidates, v)
		}
	}

	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "openclaw", "templates"),
			filepath.Join(wd, "..", "openclaw", "templates"),
		)
	}

	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, "openclaw", "templates"),
			filepath.Join(exeDir, "..", "openclaw", "templates"),
			filepath.Join(exeDir, "..", "..", "openclaw", "templates"),
		)
	}

	seen := map[string]struct{}{}
	checked := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}
		checked = append(checked, abs)
		if st, err := os.Stat(abs); err == nil && st.IsDir() {
			return abs, nil
		}
	}

	return "", fmt.Errorf("%w: checked %s", ErrTemplatesDirNotFound, strings.Join(checked, ", "))
}

func (oc *OpenClawClient) loadTemplate(templateName string) (*openclawTemplateManifest, string, error) {
	templateName = strings.TrimSpace(templateName)
	if templateName == "" || templateName != filepath.Base(templateName) || strings.Contains(templateName, "..") {
		return nil, "", fmt.Errorf("invalid template name: %q", templateName)
	}

	templatesDir, err := resolveTemplatesDir()
	if err != nil {
		return nil, "", err
	}

	templateDir := filepath.Join(templatesDir, templateName)
	manifestPath := filepath.Join(templateDir, "template.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, "", fmt.Errorf("%w: %s", ErrTemplateNotFound, templateName)
		}
		return nil, "", fmt.Errorf("read template manifest: %w", err)
	}

	var manifest openclawTemplateManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, "", fmt.Errorf("decode template manifest %s: %w", templateName, err)
	}
	if manifest.Name == "" {
		manifest.Name = templateName
	}

	return &manifest, templateDir, nil
}

func buildTemplateAgents(manifest *openclawTemplateManifest) []openclawAgent {
	agents := make([]openclawAgent, 0, len(manifest.Agents))
	workspaceRoot := manifest.workspaceRoot()

	for _, a := range manifest.Agents {
		if a.ID == "" {
			continue
		}
		agent := openclawAgent{
			ID:        a.ID,
			Workspace: workspaceRoot,
			AgentDir:  path.Join("/home/node/.openclaw/agents", a.ID),
			Model:     openclawModelRef{Primary: a.Model},
			Skills:    a.Skills,
		}
		if len(a.Cron) > 0 {
			agent.Cron = a.Cron
		}
		agents = append(agents, agent)
	}

	return agents
}

func (oc *OpenClawClient) injectTemplateAgents(ctx context.Context, userID string, data []byte) ([]byte, error) {
	if userID == "" || oc.store == nil {
		return data, nil
	}

	templateName, err := oc.store.GetContainerTemplate(ctx, userID, store.ContainerTypeOpenClaw)
	if err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("openclaw config: failed to read container template")
		return data, nil
	}
	if templateName == "" {
		return data, nil
	}

	manifest, _, err := oc.loadTemplate(templateName)
	if err != nil {
		log.Warn().Err(err).Str("template", templateName).Str("user_id", userID).Msg("openclaw config: template load failed")
		return data, nil
	}

	var cfg openclawConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("decode generated config for template injection: %w", err)
	}
	cfg.Agents.List = buildTemplateAgents(manifest)
	return json.MarshalIndent(cfg, "", "  ")
}

// ListTemplates scans openclaw/templates and returns templates with lightweight metadata.
func (oc *OpenClawClient) ListTemplates() ([]TemplateSummary, error) {
	templatesDir, err := resolveTemplatesDir()
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(templatesDir)
	if err != nil {
		return nil, fmt.Errorf("read templates dir: %w", err)
	}

	results := make([]TemplateSummary, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		manifest, _, err := oc.loadTemplate(entry.Name())
		if err != nil {
			log.Warn().Err(err).Str("template", entry.Name()).Msg("skip invalid template")
			continue
		}

		agents := make([]TemplateAgentSummary, 0, len(manifest.Agents))
		for _, a := range manifest.Agents {
			agents = append(agents, TemplateAgentSummary{
				ID:       a.ID,
				Name:     a.Name,
				Role:     a.Role,
				IsLeader: a.IsLeader,
			})
		}

		results = append(results, TemplateSummary{
			Name:        manifest.Name,
			DisplayName: manifest.DisplayName,
			Description: manifest.Description,
			Version:     manifest.Version,
			Agents:      agents,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results, nil
}

// GetTemplateSummary returns the summary for a single template by name.
func (oc *OpenClawClient) GetTemplateSummary(templateName string) (*TemplateSummary, error) {
	manifest, _, err := oc.loadTemplate(templateName)
	if err != nil {
		return nil, err
	}

	agents := make([]TemplateAgentSummary, 0, len(manifest.Agents))
	for _, a := range manifest.Agents {
		agents = append(agents, TemplateAgentSummary{
			ID:       a.ID,
			Name:     a.Name,
			Role:     a.Role,
			IsLeader: a.IsLeader,
		})
	}

	return &TemplateSummary{
		Name:        manifest.Name,
		DisplayName: manifest.DisplayName,
		Description: manifest.Description,
		Version:     manifest.Version,
		Agents:      agents,
	}, nil
}

func (oc *OpenClawClient) copyTemplateFile(containerName, sourcePath, targetPath string) error {
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("read source file %s: %w", sourcePath, err)
	}

	if _, err := oc.client.Exec(containerName, "mkdir", "-p", path.Dir(targetPath)); err != nil {
		return fmt.Errorf("mkdir target dir: %w", err)
	}

	if err := oc.client.copyFileToContainer(containerName, targetPath, data); err != nil {
		return fmt.Errorf("copy %s to %s: %w", sourcePath, targetPath, err)
	}

	return nil
}

func (oc *OpenClawClient) copyTemplateDir(containerName, sourceDir, targetRoot string) (int, error) {
	st, err := os.Stat(sourceDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, fmt.Errorf("stat source dir %s: %w", sourceDir, err)
	}
	if !st.IsDir() {
		return 0, nil
	}

	if _, err := oc.client.Exec(containerName, "mkdir", "-p", targetRoot); err != nil {
		return 0, fmt.Errorf("mkdir target root: %w", err)
	}

	copied := 0
	err = filepath.WalkDir(sourceDir, func(filePath string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		rel, err := filepath.Rel(sourceDir, filePath)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}

		targetPath := path.Join(targetRoot, filepath.ToSlash(rel))
		if d.IsDir() {
			_, err := oc.client.Exec(containerName, "mkdir", "-p", targetPath)
			return err
		}

		if err := oc.copyTemplateFile(containerName, filePath, targetPath); err != nil {
			return err
		}
		copied++
		return nil
	})

	if err != nil {
		return copied, err
	}

	return copied, nil
}

// InstallTemplate installs a team template into an existing OpenClaw container.
func (oc *OpenClawClient) InstallTemplate(ctx context.Context, info *store.ContainerInfo, templateName string) (*TemplateInstallResult, error) {
	if info == nil {
		return nil, fmt.Errorf("container info is required")
	}

	manifest, templateDir, err := oc.loadTemplate(templateName)
	if err != nil {
		return nil, err
	}

	if err := oc.EnsureRunning(ctx, info); err != nil {
		return nil, fmt.Errorf("ensure container running: %w", err)
	}

	workspaceRoot := manifest.workspaceRoot()
	if _, err := oc.client.Exec(info.ContainerName, "mkdir", "-p", workspaceRoot); err != nil {
		return nil, fmt.Errorf("mkdir workspace: %w", err)
	}

	filesCopied := 0
	for _, agentCfg := range manifest.Agents {
		if agentCfg.ID == "" {
			continue
		}

		agentDir := path.Join("/home/node/.openclaw/agents", agentCfg.ID)
		if _, err := oc.client.Exec(info.ContainerName, "mkdir", "-p", path.Join(agentDir, "skills")); err != nil {
			return nil, fmt.Errorf("mkdir agent dir %s: %w", agentCfg.ID, err)
		}

		if agentCfg.Prompt != "" {
			relPromptPath, err := normalizeTemplateRelativePath(agentCfg.Prompt)
			if err != nil {
				return nil, fmt.Errorf("invalid prompt path for agent %s: %w", agentCfg.ID, err)
			}
			sourcePrompt := filepath.Join(templateDir, filepath.FromSlash(relPromptPath))
			if err := oc.copyTemplateFile(info.ContainerName, sourcePrompt, path.Join(agentDir, "prompt.md")); err != nil {
				return nil, err
			}
			filesCopied++
		}

		for _, skill := range agentCfg.Skills {
			sourceSkillDir := filepath.Join(templateDir, "skills", skill)
			n, err := oc.copyTemplateDir(info.ContainerName, sourceSkillDir, path.Join(agentDir, "skills", skill))
			if err != nil {
				return nil, fmt.Errorf("copy skills for agent %s (%s): %w", agentCfg.ID, skill, err)
			}
			filesCopied += n
		}
	}

	if n, err := oc.copyTemplateDir(info.ContainerName, filepath.Join(templateDir, "rules"), workspaceRoot); err != nil {
		return nil, fmt.Errorf("copy rules: %w", err)
	} else {
		filesCopied += n
	}

	if n, err := oc.copyTemplateDir(info.ContainerName, filepath.Join(templateDir, "workspace"), workspaceRoot); err != nil {
		return nil, fmt.Errorf("copy workspace: %w", err)
	} else {
		filesCopied += n
	}

	for target, source := range manifest.Workspace.Files {
		relSource, err := normalizeTemplateRelativePath(source)
		if err != nil {
			return nil, fmt.Errorf("invalid workspace source %q: %w", source, err)
		}
		relTarget, err := normalizeTemplateRelativePath(target)
		if err != nil {
			return nil, fmt.Errorf("invalid workspace target %q: %w", target, err)
		}

		sourcePath := filepath.Join(templateDir, filepath.FromSlash(relSource))
		targetPath := path.Join(workspaceRoot, relTarget)
		if err := oc.copyTemplateFile(info.ContainerName, sourcePath, targetPath); err != nil {
			return nil, fmt.Errorf("copy workspace mapped file %s: %w", target, err)
		}
		filesCopied++
	}

	if oc.store != nil {
		if err := oc.store.SetContainerTemplate(ctx, info.UserID, info.ContainerType, manifest.Name); err != nil {
			return nil, fmt.Errorf("save container template: %w", err)
		}
	}

	configChanged, err := oc.SyncConfig(ctx, info)
	if err != nil {
		return nil, fmt.Errorf("sync config with template: %w", err)
	}

	log.Info().Str("container", info.ContainerName).Str("template", manifest.Name).Int("files", filesCopied).Msg("openclaw template installed")

	return &TemplateInstallResult{
		Template:      manifest.Name,
		Container:     info.ContainerName,
		Workspace:     workspaceRoot,
		Agents:        len(buildTemplateAgents(manifest)),
		FilesCopied:   filesCopied,
		ConfigChanged: configChanged,
	}, nil
}

// openclawConfig is the JSON structure for openclaw.json.
type openclawConfig struct {
	Models   openclawModels   `json:"models"`
	Agents   openclawAgents   `json:"agents"`
	Tools    openclawTools    `json:"tools"`
	Commands openclawCommands `json:"commands"`
	Session  openclawSession  `json:"session"`
	Gateway  openclawGateway  `json:"gateway"`
}

type openclawModels struct {
	Mode      string                      `json:"mode"`
	Providers map[string]openclawProvider `json:"providers"`
}

type openclawProvider struct {
	BaseURL string          `json:"baseUrl"`
	APIKey  string          `json:"apiKey"`
	API     string          `json:"api"`
	Models  []openclawModel `json:"models"`
}

type openclawModel struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	ContextWindow int    `json:"contextWindow"`
	MaxTokens     int    `json:"maxTokens"`
	Reasoning     bool   `json:"reasoning,omitempty"`
}

type openclawAgents struct {
	Defaults openclawAgentDefaults `json:"defaults"`
	List     []openclawAgent       `json:"list,omitempty"`
}

type openclawAgent struct {
	ID        string           `json:"id"`
	Workspace string           `json:"workspace"`
	AgentDir  string           `json:"agentDir"`
	Model     openclawModelRef `json:"model"`
	Skills    []string         `json:"skills,omitempty"`
	Cron      json.RawMessage  `json:"cron,omitempty"`
}

type openclawAgentDefaults struct {
	Model      openclawModelRef   `json:"model"`
	Workspace  string             `json:"workspace"`
	Compaction openclawCompaction `json:"compaction"`
	Sandbox    openclawSandbox    `json:"sandbox"`
}

type openclawModelRef struct {
	Primary string `json:"primary"`
}

type openclawCompaction struct {
	Mode               string              `json:"mode"`
	ReserveTokensFloor int                 `json:"reserveTokensFloor"`
	MemoryFlush        openclawMemoryFlush `json:"memoryFlush"`
}

type openclawMemoryFlush struct {
	Enabled             bool `json:"enabled"`
	SoftThresholdTokens int  `json:"softThresholdTokens"`
}

type openclawSandbox struct {
	Mode string `json:"mode"`
}

type openclawTools struct {
	Deny []string `json:"deny"`
}

type openclawCommands struct {
	Native       string `json:"native"`
	NativeSkills string `json:"nativeSkills"`
	Restart      bool   `json:"restart"`
}

type openclawSession struct {
	DMScope string            `json:"dmScope"`
	Reset   openclawResetMode `json:"reset"`
}

type openclawResetMode struct {
	Mode string `json:"mode"`
}

type openclawGateway struct {
	Port           int               `json:"port"`
	Bind           string            `json:"bind"`
	Auth           openclawAuth      `json:"auth"`
	ControlUI      openclawControlUI `json:"controlUi"`
	TrustedProxies []string          `json:"trustedProxies,omitempty"`
}

type openclawAuth struct {
	Mode  string `json:"mode"`
	Token string `json:"token"`
}

type openclawControlUI struct {
	AllowedOrigins               []string `json:"allowedOrigins"`
	DangerouslyDisableDeviceAuth bool     `json:"dangerouslyDisableDeviceAuth,omitempty"`
}

// GenerateConfig generates openclaw.json content as JSON bytes.
// Deprecated: Use GenerateConfigFromDB which reads providers/models from DB.
func (oc *OpenClawClient) GenerateConfig(token string, llm config.LLMConfig) ([]byte, error) {
	primaryModel := "proxy/gpt-5.4"
	if llm.PrimaryModel != "" {
		if strings.Contains(llm.PrimaryModel, "/") {
			primaryModel = llm.PrimaryModel
		} else {
			primaryModel = "proxy/" + llm.PrimaryModel
		}
	}

	cfg := openclawConfig{
		Models: openclawModels{
			Mode: "merge",
			Providers: map[string]openclawProvider{
				"proxy": {
					BaseURL: llm.ProxyURL + "/v1",
					APIKey:  "${LLM_PROXY_KEY}",
					API:     "openai-completions",
					Models: []openclawModel{
						{ID: "gpt-5.4", Name: "GPT 5.4", ContextWindow: 128000, MaxTokens: 16384},
						{ID: "claude-sonnet-4-6", Name: "Sonnet 4.6", ContextWindow: 200000, MaxTokens: 16384},
						{ID: "claude-opus-4-6", Name: "Opus 4.6", ContextWindow: 200000, MaxTokens: 32000, Reasoning: true},
						{ID: "grok-4.1-fast", Name: "Grok 4.1 Fast", ContextWindow: 131072, MaxTokens: 16384},
						{ID: "gemini-3.1-pro-preview", Name: "Gemini 3.1 Pro", ContextWindow: 1000000, MaxTokens: 8192},
					},
				},
			},
		},
		Agents: openclawAgents{
			Defaults: openclawAgentDefaults{
				Model:     openclawModelRef{Primary: primaryModel},
				Workspace: "/data/workspace",
				Compaction: openclawCompaction{
					Mode:               "safeguard",
					ReserveTokensFloor: 32768,
					MemoryFlush: openclawMemoryFlush{
						Enabled:             true,
						SoftThresholdTokens: 6000,
					},
				},
				Sandbox: openclawSandbox{Mode: "off"},
			},
		},
		Tools:    openclawTools{Deny: []string{"gateway"}},
		Commands: openclawCommands{Native: "auto", NativeSkills: "auto", Restart: true},
		Session:  openclawSession{DMScope: "per-channel-peer", Reset: openclawResetMode{Mode: "idle"}},
		Gateway: openclawGateway{
			Port: 18789,
			Bind: "lan",
			Auth: openclawAuth{Mode: "token", Token: token},
			ControlUI: openclawControlUI{
				AllowedOrigins: []string{
					"http://localhost:18789",
					"http://127.0.0.1:18789",
					fmt.Sprintf("http://%s:%d", oc.client.hostIP, oc.client.agentPort),
				},
			},
			TrustedProxies: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"},
		},
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// GenerateConfigFromDB generates openclaw.json from DB-backed providers and models.
// Falls back to the hardcoded GenerateConfig if the DB query fails or returns no providers.
func (oc *OpenClawClient) GenerateConfigFromDB(ctx context.Context, userID, token string) ([]byte, error) {
	if oc.store == nil {
		llm := oc.getLLM()
		return oc.GenerateConfig(token, llm)
	}

	providers, err := oc.store.ListProviders(ctx)
	if err != nil || len(providers) == 0 {
		if err != nil {
			log.Warn().Err(err).Msg("openclaw config: DB providers query failed, using hardcoded fallback")
		} else {
			log.Warn().Msg("openclaw config: no providers in DB, using hardcoded fallback")
		}
		llm := oc.getLLM()
		data, genErr := oc.GenerateConfig(token, llm)
		if genErr != nil {
			return nil, genErr
		}
		return oc.injectTemplateAgents(ctx, userID, data)
	}

	llm := oc.getLLM()

	// Build providers map from DB
	ocProviders := make(map[string]openclawProvider)
	for _, p := range providers {
		if !p.Enabled {
			continue
		}

		models, err := oc.store.ListModelsByProvider(ctx, p.Key)
		if err != nil {
			log.Warn().Err(err).Str("provider", p.Key).Msg("openclaw config: list models failed, skipping provider")
			continue
		}

		var ocModels []openclawModel
		for _, m := range models {
			if !m.Enabled {
				continue
			}
			ocModels = append(ocModels, openclawModel{
				ID:            m.ModelID,
				Name:          m.DisplayName,
				ContextWindow: m.ContextWindow,
				MaxTokens:     m.MaxTokens,
				Reasoning:     m.Reasoning,
			})
		}

		if len(ocModels) == 0 {
			continue
		}

		// Resolve API key: use the ref to look up from system_settings
		apiKey := "${LLM_PROXY_KEY}"
		if p.APIKeyRef != "" && p.APIKeyRef != "llm_proxy_key" {
			if val, err := oc.store.GetSetting(ctx, p.APIKeyRef); err == nil && val != "" {
				apiKey = val
			}
		}

		// Resolve base URL: use provider's base_url, falling back to proxy
		baseURL := p.BaseURL
		if baseURL == "" {
			baseURL = llm.ProxyURL + "/v1"
		}

		ocProviders[p.Key] = openclawProvider{
			BaseURL: baseURL,
			APIKey:  apiKey,
			API:     p.APIType,
			Models:  ocModels,
		}
	}

	if len(ocProviders) == 0 {
		log.Warn().Msg("openclaw config: no enabled providers with models, using hardcoded fallback")
		data, genErr := oc.GenerateConfig(token, llm)
		if genErr != nil {
			return nil, genErr
		}
		return oc.injectTemplateAgents(ctx, userID, data)
	}

	// Determine primary model
	primaryModel := "proxy/gpt-5.4"
	if llm.PrimaryModel != "" {
		if strings.Contains(llm.PrimaryModel, "/") {
			primaryModel = llm.PrimaryModel
		} else {
			primaryModel = "proxy/" + llm.PrimaryModel
		}
	}

	cfg := openclawConfig{
		Models: openclawModels{
			Mode:      "merge",
			Providers: ocProviders,
		},
		Agents: openclawAgents{
			Defaults: openclawAgentDefaults{
				Model:     openclawModelRef{Primary: primaryModel},
				Workspace: "/data/workspace",
				Compaction: openclawCompaction{
					Mode:               "safeguard",
					ReserveTokensFloor: 32768,
					MemoryFlush: openclawMemoryFlush{
						Enabled:             true,
						SoftThresholdTokens: 6000,
					},
				},
				Sandbox: openclawSandbox{Mode: "off"},
			},
		},
		Tools:    openclawTools{Deny: []string{"gateway"}},
		Commands: openclawCommands{Native: "auto", NativeSkills: "auto", Restart: true},
		Session:  openclawSession{DMScope: "per-channel-peer", Reset: openclawResetMode{Mode: "idle"}},
		Gateway: openclawGateway{
			Port: 18789,
			Bind: "lan",
			Auth: openclawAuth{Mode: "token", Token: token},
			ControlUI: openclawControlUI{
				AllowedOrigins: []string{
					"http://localhost:18789",
					"http://127.0.0.1:18789",
					fmt.Sprintf("http://%s:%d", oc.client.hostIP, oc.client.agentPort),
				},
			},
			TrustedProxies: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"},
		},
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, err
	}
	return oc.injectTemplateAgents(ctx, userID, data)
}

// WriteConfig generates and writes openclaw.json into the container via Docker SDK.
func (oc *OpenClawClient) WriteConfig(userID, token string) error {
	ctx := context.Background()

	data, err := oc.GenerateConfigFromDB(ctx, userID, token)
	if err != nil {
		return fmt.Errorf("generate openclaw config: %w", err)
	}

	// Write config to host bind-mount directory via SSH (container doesn't exist yet at this point)
	userDir := fmt.Sprintf("%s/%s", oc.dataRoot, userID)
	{
		configDir := userDir + "/.openclaw"

		if _, sshErr := oc.client.RunSSH("mkdir", "-p", configDir); sshErr != nil {
			return fmt.Errorf("mkdir config dir: %w", sshErr)
		}
		if _, sshErr := oc.client.RunSSH("mkdir", "-p", userDir+"/workspace"); sshErr != nil {
			return fmt.Errorf("mkdir workspace dir: %w", sshErr)
		}
		if _, sshErr := oc.client.RunSSH("mkdir", "-p", userDir+"/workspace/jamoss/data", userDir+"/workspace/jamoss/logs"); sshErr != nil {
			return fmt.Errorf("mkdir jamoss workspace dirs: %w", sshErr)
		}

		// Install team-builder skill to default agent skills (enables self-service team creation)
		teamBuilderDir := configDir + "/skills/team-builder"
		if _, sshErr := oc.client.RunSSH("mkdir", "-p", teamBuilderDir); sshErr != nil {
			log.Warn().Err(sshErr).Msg("openclaw: mkdir team-builder skill dir failed")
		} else {
			if skillData, skillErr := oc.loadTeamBuilderSkill(); skillErr == nil {
				escaped := strings.ReplaceAll(string(skillData), "'", "'\\''")
				writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s/SKILL.md", escaped, teamBuilderDir)
				if _, sshErr := oc.client.RunSSH("bash", "-c", fmt.Sprintf("'%s'", writeCmd)); sshErr != nil {
					log.Warn().Err(sshErr).Msg("openclaw: write team-builder SKILL.md failed")
				}
			} else {
				log.Warn().Err(skillErr).Msg("openclaw: load team-builder skill failed")
			}
		}

		hostConfigPath := configDir + "/openclaw.json"
		escaped := strings.ReplaceAll(string(data), "'", "'\\''")
		writeCmd := fmt.Sprintf("printf '%%s' '%s' > %s", escaped, hostConfigPath)
		if _, sshErr := oc.client.RunSSH("bash", "-c", fmt.Sprintf("'%s'", writeCmd)); sshErr != nil {
			return fmt.Errorf("write config: %w", sshErr)
		}

		if _, sshErr := oc.client.RunSSH("chown", "-R", "1000:1000", userDir); sshErr != nil {
			return fmt.Errorf("chown user dir: %w", sshErr)
		}

		log.Info().Str("user_id", userID).Str("path", hostConfigPath).Msg("openclaw config written to host")
	}
	return nil
}

// SyncConfig writes openclaw.json into a running container via docker copy.
// Uses content-hash comparison to skip writes when config hasn't changed.
// Returns true if config was actually written.
func (oc *OpenClawClient) SyncConfig(ctx context.Context, info *store.ContainerInfo) (bool, error) {
	data, err := oc.GenerateConfigFromDB(ctx, info.UserID, info.ContainerToken)
	if err != nil {
		return false, fmt.Errorf("generate config: %w", err)
	}

	hash := sha256hex(data)

	// Check if the container already has this config applied
	if oc.store != nil {
		botCfg, _ := oc.store.GetBotConfig(ctx, info.UserID, info.ContainerType)
		_ = botCfg // we only need applied_config_hash, checked via direct query
		var appliedHash string
		_ = oc.store.Pool().QueryRow(ctx,
			`SELECT COALESCE(applied_config_hash, '') FROM containers WHERE user_id = $1 AND container_type = $2`,
			info.UserID, info.ContainerType,
		).Scan(&appliedHash)
		if hash == appliedHash && appliedHash != "" {
			return false, nil
		}
	}

	// Write config into the running container
	configPath := "/home/node/.openclaw/openclaw.json"
	if err := oc.client.copyFileToContainer(info.ContainerName, configPath, data); err != nil {
		return false, fmt.Errorf("copy config to container: %w", err)
	}

	// Update applied_config_hash in DB
	if oc.store != nil {
		if err := oc.store.UpdateAppliedConfigHash(ctx, info.UserID, info.ContainerType, hash); err != nil {
			log.Warn().Err(err).Str("user_id", info.UserID).Msg("openclaw sync: update applied hash failed")
		}
	}

	log.Info().Str("container", info.ContainerName).Str("hash", hash[:12]).Msg("openclaw config synced")
	return true, nil
}

// sha256hex computes the hex-encoded SHA-256 hash of data.
func sha256hex(data []byte) string {
	h := sha256.Sum256(data)
	return fmt.Sprintf("%x", h)
}

// ContainerEnvVars builds the environment variables map for an OpenClaw container.
func (oc *OpenClawClient) ContainerEnvVars() map[string]string {
	llm := oc.getLLM()
	envs := map[string]string{}

	set := func(key, val string) {
		if val != "" {
			envs[key] = val
		}
	}

	set("LLM_PROXY_URL", llm.ProxyURL)
	set("LLM_PROXY_KEY", llm.ProxyKey)
	set("OPENAI_API_KEY", llm.OpenAIAPIKey)
	set("EXA_API_KEY", llm.ExaAPIKey)
	set("TAVILY_API_KEY", llm.TavilyKey)
	set("FAL_API_KEY", llm.FalAPIKey)
	set("JIMENG_API_URL", llm.JimengAPIURL)
	set("JIMENG_API_KEY", llm.JimengAPIKey)
	set("EMBEDDING_BASE_URL", llm.EmbeddingBaseURL)
	set("EMBEDDING_API_KEY", llm.EmbeddingAPIKey)

	return envs
}

// Provision creates and starts a new OpenClaw container for a user.
func (oc *OpenClawClient) Provision(name, userID, token string, hostPort int) (string, error) {
	log.Info().Str("name", name).Str("user_id", userID).Int("host_port", hostPort).Msg("provisioning openclaw container")

	if err := oc.WriteConfig(userID, token); err != nil {
		return "", fmt.Errorf("write config: %w", err)
	}

	ctx := context.Background()
	userDir := fmt.Sprintf("%s/%s", oc.dataRoot, userID)

	envVars := oc.ContainerEnvVars()
	envVars["OPENCLAW_GATEWAY_TOKEN"] = token
	var env []string
	for k, v := range envVars {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	port := nat.Port("18789/tcp")
	containerCfg := &container.Config{
		Image: oc.client.image,
		Env:   env,
		Labels: map[string]string{
			"jacoworks.managed": "true",
			"jacoworks.type":    "openclaw",
			"jacoworks.user_id": userID,
		},
		Healthcheck: &container.HealthConfig{
			Test:     []string{"CMD-SHELL", "curl -fsS http://127.0.0.1:18789/healthz || exit 1"},
			Interval: 30 * time.Second,
			Timeout:  5 * time.Second,
			Retries:  3,
		},
	}

	hostCfg := &container.HostConfig{
		RestartPolicy: container.RestartPolicy{Name: "unless-stopped"},
		PortBindings: nat.PortMap{
			port: []nat.PortBinding{
				{HostPort: fmt.Sprintf("%d", hostPort)},
			},
		},
		Mounts: []mount.Mount{
			{
				Type:   mount.TypeBind,
				Source: fmt.Sprintf("%s/.openclaw", userDir),
				Target: "/home/node/.openclaw",
			},
			{
				Type:   mount.TypeBind,
				Source: fmt.Sprintf("%s/workspace", userDir),
				Target: "/data/workspace",
			},
		},
	}

	resp, err := oc.client.cli.ContainerCreate(ctx, containerCfg, hostCfg, nil, nil, name)
	if err != nil {
		return "", fmt.Errorf("docker run %s: %w", name, err)
	}

	if err := oc.client.cli.ContainerStart(ctx, resp.ID, types.ContainerStartOptions{}); err != nil {
		return "", fmt.Errorf("docker start %s: %w", name, err)
	}

	time.Sleep(3 * time.Second)

	healthURL := fmt.Sprintf("http://%s:%d/healthz", oc.client.hostIP, hostPort)
	if err := oc.waitForHealthURL(healthURL, 60*time.Second); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("openclaw container started but health check failed")
	}

	if err := oc.InstallJaMOSS(name, userID, token); err != nil {
		log.Warn().Err(err).Str("container", name).Str("user_id", userID).Msg("jamoss install failed during provision")
	}

	log.Info().Str("name", name).Str("host_ip", oc.client.hostIP).Int("host_port", hostPort).Msg("openclaw container provisioned")
	return oc.client.hostIP, nil
}

// waitForHealthURL polls a URL until it returns HTTP 200.
func (oc *OpenClawClient) waitForHealthURL(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 --max-time 5 %s", url)

	log.Debug().Str("url", url).Dur("timeout", timeout).Msg("waiting for openclaw health")

	for time.Now().Before(deadline) {
		out, err := oc.client.RunSSH(curlCmd)
		if err == nil {
			code := strings.TrimSpace(strings.Trim(out, "'"))
			if code == "200" {
				log.Info().Str("url", url).Msg("openclaw container healthy")
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("openclaw at %s not healthy after %s", url, timeout)
}

func (oc *OpenClawClient) waitForContainerHealthURL(containerName, url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	curlCmd := fmt.Sprintf("curl -s -o /dev/null -w '%%{http_code}' --connect-timeout 2 --max-time 5 %s || true", url)

	for time.Now().Before(deadline) {
		out, err := oc.client.Exec(containerName, "sh", "-lc", curlCmd)
		if err == nil {
			code := strings.TrimSpace(strings.Trim(out, "'"))
			if code == "200" {
				return nil
			}
		}
		time.Sleep(2 * time.Second)
	}

	return fmt.Errorf("container %s endpoint %s not healthy after %s", containerName, url, timeout)
}

func (oc *OpenClawClient) execChecked(containerName, script string) error {
	const sentinel = "__JACOWORKS_EXEC_OK__"
	out, err := oc.client.Exec(containerName, "sh", "-lc", fmt.Sprintf("set -eu; %s; printf %s", script, sentinel))
	if err != nil {
		return err
	}
	if !strings.Contains(out, sentinel) {
		return fmt.Errorf("exec failed: %s", strings.TrimSpace(out))
	}
	return nil
}

// loadTeamBuilderSkill reads the team-builder SKILL.md from the openclaw/skills directory.
func (oc *OpenClawClient) loadTeamBuilderSkill() ([]byte, error) {
	candidates := []string{
		filepath.Join("openclaw", "skills", "team-builder", "SKILL.md"),
		filepath.Join("..", "openclaw", "skills", "team-builder", "SKILL.md"),
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "openclaw", "skills", "team-builder", "SKILL.md"),
			filepath.Join(wd, "..", "openclaw", "skills", "team-builder", "SKILL.md"),
		)
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, "openclaw", "skills", "team-builder", "SKILL.md"),
			filepath.Join(exeDir, "..", "openclaw", "skills", "team-builder", "SKILL.md"),
		)
	}
	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err == nil {
			return data, nil
		}
	}
	return nil, fmt.Errorf("team-builder SKILL.md not found")
}

func resolveJaMOSSRoot() (string, error) {
	candidates := []string{
		filepath.Join("openclaw", "jamoss"),
		filepath.Join("..", "openclaw", "jamoss"),
		filepath.Join("..", "..", "openclaw", "jamoss"),
		filepath.Join("openclaw", "openmoss"),
		filepath.Join("..", "openclaw", "openmoss"),
		filepath.Join("..", "..", "openclaw", "openmoss"),
	}

	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "openclaw", "jamoss"),
			filepath.Join(wd, "..", "openclaw", "jamoss"),
			filepath.Join(wd, "..", "..", "openclaw", "jamoss"),
			filepath.Join(wd, "openclaw", "openmoss"),
			filepath.Join(wd, "..", "openclaw", "openmoss"),
			filepath.Join(wd, "..", "..", "openclaw", "openmoss"),
		)
	}

	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(exeDir, "openclaw", "jamoss"),
			filepath.Join(exeDir, "..", "openclaw", "jamoss"),
			filepath.Join(exeDir, "..", "..", "openclaw", "jamoss"),
			filepath.Join(exeDir, "..", "..", "..", "openclaw", "jamoss"),
			filepath.Join(exeDir, "openclaw", "openmoss"),
			filepath.Join(exeDir, "..", "openclaw", "openmoss"),
			filepath.Join(exeDir, "..", "..", "openclaw", "openmoss"),
			filepath.Join(exeDir, "..", "..", "..", "openclaw", "openmoss"),
		)
	}

	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		abs, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if _, ok := seen[abs]; ok {
			continue
		}
		seen[abs] = struct{}{}

		probe := filepath.Join(abs, "app", "main.py")
		if st, statErr := os.Stat(probe); statErr == nil && !st.IsDir() {
			return abs, nil
		}
	}

	return "", fmt.Errorf("jamoss source not found in known paths")
}

func (oc *OpenClawClient) copyDirToContainer(containerName, srcDir, dstDir string) error {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	walkErr := filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return err
		}

		hdr, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		hdr.Name = filepath.ToSlash(filepath.Join(dstDir, rel))
		if d.IsDir() && !strings.HasSuffix(hdr.Name, "/") {
			hdr.Name += "/"
		}

		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}

		f, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tw, f)
		closeErr := f.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		return nil
	})
	if walkErr != nil {
		_ = tw.Close()
		return fmt.Errorf("build tar from %s: %w", srcDir, walkErr)
	}

	if err := tw.Close(); err != nil {
		return fmt.Errorf("close tar writer: %w", err)
	}

	if err := oc.client.cli.CopyToContainer(context.Background(), containerName, "/", &buf, types.CopyToContainerOptions{}); err != nil {
		return fmt.Errorf("copy dir to container: %w", err)
	}
	return nil
}

func renderJaMOSSConfig(template []byte, userID, token string) []byte {
	content := string(template)
	content = strings.ReplaceAll(content, "{team_id}", userID)
	content = strings.ReplaceAll(content, `registration_token: "openclaw-register-2024"`, fmt.Sprintf(`registration_token: "%s"`, token))
	content = strings.ReplaceAll(content, `path: "./data/tasks.db"`, `path: "/data/workspace/jamoss/tasks.db"`)
	content = strings.ReplaceAll(content, `root: "./workspace"`, `root: "/data/workspace"`)
	return []byte(content)
}

func jaMOSSStartScriptContent() []byte {
	return []byte(`#!/bin/sh
set -eu

PYTHON_BIN="python3"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

cd /opt/jamoss
mkdir -p /data/workspace/jamoss
exec "$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port 6565
`)
}

// InstallJaMOSS installs and starts JaMOSS middleware inside an OpenClaw container.
func (oc *OpenClawClient) InstallJaMOSS(containerName, userID, token string) error {
	root, err := resolveJaMOSSRoot()
	if err != nil {
		return err
	}

	if err := oc.execChecked(containerName, fmt.Sprintf("mkdir -p %s/skills /data/workspace/jamoss /data/workspace/jamoss/logs", jaMOSSContainerRoot)); err != nil {
		return fmt.Errorf("prepare jamoss directories: %w", err)
	}

	if err := oc.copyDirToContainer(containerName, filepath.Join(root, "app"), filepath.Join(jaMOSSContainerRoot, "app")); err != nil {
		return fmt.Errorf("copy jamoss app: %w", err)
	}

	requirements, err := os.ReadFile(filepath.Join(root, "requirements.txt"))
	if err != nil {
		return fmt.Errorf("read requirements.txt: %w", err)
	}
	if err := oc.client.copyFileToContainer(containerName, filepath.Join(jaMOSSContainerRoot, "requirements.txt"), requirements); err != nil {
		return fmt.Errorf("copy requirements.txt: %w", err)
	}

	taskCLI, err := os.ReadFile(filepath.Join(root, "skills", "task-cli.py"))
	if err != nil {
		return fmt.Errorf("read task-cli.py: %w", err)
	}
	if err := oc.client.copyFileToContainer(containerName, filepath.Join(jaMOSSContainerRoot, "skills", "task-cli.py"), taskCLI); err != nil {
		return fmt.Errorf("copy task-cli.py: %w", err)
	}

	configTemplate, err := os.ReadFile(filepath.Join(root, "config.example.yaml"))
	if err != nil {
		return fmt.Errorf("read config.example.yaml: %w", err)
	}
	configYAML := renderJaMOSSConfig(configTemplate, userID, token)
	if err := oc.client.copyFileToContainer(containerName, filepath.Join(jaMOSSContainerRoot, "config.yaml"), configYAML); err != nil {
		return fmt.Errorf("copy config.yaml: %w", err)
	}

	if err := oc.client.copyFileToContainer(containerName, jaMOSSStartScript, jaMOSSStartScriptContent()); err != nil {
		return fmt.Errorf("copy start-jamoss.sh: %w", err)
	}

	if err := oc.execChecked(containerName, fmt.Sprintf("chmod +x %s %s", jaMOSSStartScript, filepath.Join(jaMOSSContainerRoot, "skills", "task-cli.py"))); err != nil {
		return fmt.Errorf("chmod jamoss scripts: %w", err)
	}

	installCmd := fmt.Sprintf(`
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN=python
else
  echo "python runtime not found"
  exit 1
fi

"$PYTHON_BIN" -m pip --version >/dev/null 2>&1 || "$PYTHON_BIN" -m ensurepip --upgrade
"$PYTHON_BIN" -m pip install --no-cache-dir --user -r %s/requirements.txt aiofiles python-multipart
`, jaMOSSContainerRoot)
	if err := oc.execChecked(containerName, installCmd); err != nil {
		return fmt.Errorf("install python dependencies: %w", err)
	}

	startCmd := fmt.Sprintf(`
if pgrep -f "uvicorn app.main:app --host 0.0.0.0 --port 6565" >/dev/null 2>&1; then
  true
else
  nohup %s > /data/workspace/jamoss/logs/jamoss.log 2>&1 &
fi
`, jaMOSSStartScript)
	if err := oc.execChecked(containerName, startCmd); err != nil {
		return fmt.Errorf("start jamoss service: %w", err)
	}

	if err := oc.waitForContainerHealthURL(containerName, jaMOSSHealthEndpoint, 60*time.Second); err != nil {
		return err
	}

	log.Info().Str("container", containerName).Str("user_id", userID).Msg("jamoss middleware installed and healthy")
	return nil
}

// EnsureRunning checks the container status and brings it to a running state.
// After the container is healthy, it syncs config if needed.
func (oc *OpenClawClient) EnsureRunning(ctx context.Context, info *store.ContainerInfo) error {
	status, err := oc.client.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	healthURL := fmt.Sprintf("http://%s:%d/healthz", oc.client.hostIP, info.HostPort)

	var healthErr error
	switch status.Status {
	case "running":
		healthErr = oc.waitForHealthURL(healthURL, 15*time.Second)
	case "paused":
		if err := oc.client.Unpause(info.ContainerName); err != nil {
			return fmt.Errorf("unpause: %w", err)
		}
		healthErr = oc.waitForHealthURL(healthURL, 30*time.Second)
	case "exited":
		if err := oc.client.Start(info.ContainerName); err != nil {
			return fmt.Errorf("start: %w", err)
		}
		time.Sleep(2 * time.Second)
		healthErr = oc.waitForHealthURL(healthURL, 30*time.Second)
	case "not_found":
		log.Info().Str("name", info.ContainerName).Str("user_id", info.UserID).Msg("openclaw container not found, reprovisioning")
		if _, err := oc.Provision(info.ContainerName, info.UserID, info.ContainerToken, info.HostPort); err != nil {
			return fmt.Errorf("reprovision %s: %w", info.ContainerName, err)
		}
		return nil
	default:
		return fmt.Errorf("container %s in unexpected state: %s", info.ContainerName, status.Status)
	}

	if healthErr != nil {
		return healthErr
	}

	// Sync config after container is running and healthy
	if changed, err := oc.SyncConfig(ctx, info); err != nil {
		log.Warn().Err(err).Str("name", info.ContainerName).Msg("config sync failed after ensure running")
	} else if changed {
		log.Info().Str("name", info.ContainerName).Msg("config synced on ensure running")
	}

	if err := oc.waitForContainerHealthURL(info.ContainerName, jaMOSSHealthEndpoint, 5*time.Second); err != nil {
		startCmd := fmt.Sprintf(`
if pgrep -f "uvicorn app.main:app --host 0.0.0.0 --port 6565" >/dev/null 2>&1; then
  true
else
  nohup %s > /data/workspace/jamoss/logs/jamoss.log 2>&1 &
fi
`, jaMOSSStartScript)
		if startErr := oc.execChecked(info.ContainerName, startCmd); startErr != nil {
			log.Warn().Err(startErr).Str("name", info.ContainerName).Msg("jamoss start failed on ensure running")
		} else if healthErr := oc.waitForContainerHealthURL(info.ContainerName, jaMOSSHealthEndpoint, 30*time.Second); healthErr != nil {
			log.Warn().Err(healthErr).Str("name", info.ContainerName).Msg("jamoss health check failed on ensure running")
		}
	}

	return nil
}

// UpstreamAddr returns the WebSocket upstream address for an OpenClaw container.
// Uses the container's own IP from DB if available, falling back to the docker client's host IP.
func (oc *OpenClawClient) UpstreamAddr(info *store.ContainerInfo) string {
	host := oc.client.hostIP
	if info.ContainerIP != "" {
		host = info.ContainerIP
	}
	port := info.HostPort
	if port == 0 {
		port = oc.client.agentPort
	}
	return fmt.Sprintf("ws://%s:%d", host, port)
}
