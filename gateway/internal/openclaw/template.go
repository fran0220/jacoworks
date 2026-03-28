package openclaw

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/rs/zerolog/log"
)

// ── Template types ───────────────────────────────────────────

type TemplateSummary struct {
	Type        string                 `json:"type"`
	Name        string                 `json:"name"`
	DisplayName string                 `json:"displayName"`
	Description string                 `json:"description"`
	Version     string                 `json:"version"`
	Agents      []TemplateAgentSummary `json:"agents"`
	Theme       json.RawMessage        `json:"theme,omitempty"`
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
	Middleware  openclawTemplateMiddleware    `json:"middleware"`
	Theme       json.RawMessage               `json:"theme,omitempty"`
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

type openclawTemplateMiddleware struct {
	Type     string `json:"type"`
	Port     int    `json:"port"`
	Database string `json:"database"`
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

func (m *openclawTemplateManifest) middlewareDatabasePath() string {
	raw := strings.TrimSpace(m.Middleware.Database)
	if raw == "" {
		return ""
	}
	return strings.ReplaceAll(raw, "{team_id}", m.teamID())
}

// ── Template resolution ──────────────────────────────────────

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

func (c *Client) loadTemplate(templateName string) (*openclawTemplateManifest, string, error) {
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

// ── Template listing ─────────────────────────────────────────

// ListTemplates scans openclaw/templates and returns templates with lightweight metadata.
func (c *Client) ListTemplates() ([]TemplateSummary, error) {
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

		manifest, _, err := c.loadTemplate(entry.Name())
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
			Type:        "team",
			Name:        manifest.Name,
			DisplayName: manifest.DisplayName,
			Description: manifest.Description,
			Version:     manifest.Version,
			Agents:      agents,
			Theme:       manifest.Theme,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results, nil
}

// GetTemplateSummary returns the summary for a single template by name.
func (c *Client) GetTemplateSummary(templateName string) (*TemplateSummary, error) {
	manifest, _, err := c.loadTemplate(templateName)
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
		Type:        "team",
		Name:        manifest.Name,
		DisplayName: manifest.DisplayName,
		Description: manifest.Description,
		Version:     manifest.Version,
		Agents:      agents,
		Theme:       manifest.Theme,
	}, nil
}

// ── Template CRUD ────────────────────────────────────────────

// TemplateDetail is the full representation of a template including file contents.
type TemplateDetail struct {
	Type        string                        `json:"type"`
	Name        string                        `json:"name"`
	DisplayName string                        `json:"displayName"`
	Description string                        `json:"description"`
	Version     string                        `json:"version"`
	Agents      []openclawTemplateAgent       `json:"agents"`
	Workspace   openclawTemplateWorkspaceSpec `json:"workspace"`
	Middleware  openclawTemplateMiddleware    `json:"middleware"`
	Files       map[string]string             `json:"files,omitempty"`
	Theme       json.RawMessage               `json:"theme,omitempty"`
}

// GetTemplateDetail loads a template's manifest and all text files in its directory.
func (c *Client) GetTemplateDetail(name string) (*TemplateDetail, error) {
	manifest, templateDir, err := c.loadTemplate(name)
	if err != nil {
		return nil, err
	}

	files := make(map[string]string)
	err = filepath.WalkDir(templateDir, func(filePath string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}

		rel, err := filepath.Rel(templateDir, filePath)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if rel == "template.json" {
			return nil
		}

		data, err := os.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("read file %s: %w", rel, err)
		}
		files[rel] = string(data)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk template dir %s: %w", name, err)
	}

	log.Debug().Str("template", name).Int("files", len(files)).Msg("loaded template detail")

	return &TemplateDetail{
		Type:        "team",
		Name:        manifest.Name,
		DisplayName: manifest.DisplayName,
		Description: manifest.Description,
		Version:     manifest.Version,
		Agents:      manifest.Agents,
		Workspace:   manifest.Workspace,
		Middleware:  manifest.Middleware,
		Files:       files,
		Theme:       manifest.Theme,
	}, nil
}

// validateTemplateName checks the template name is safe for filesystem use.
func validateTemplateName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name != filepath.Base(name) || strings.Contains(name, "..") {
		return fmt.Errorf("invalid template name: %q", name)
	}
	return nil
}

// SaveTemplate writes a template manifest and its files to the templates directory.
func (c *Client) SaveTemplate(detail *TemplateDetail) error {
	if err := validateTemplateName(detail.Name); err != nil {
		return err
	}

	templatesDir, err := resolveTemplatesDir()
	if err != nil {
		return err
	}

	templateDir := filepath.Join(templatesDir, detail.Name)
	if err := os.MkdirAll(templateDir, 0o755); err != nil {
		return fmt.Errorf("create template dir: %w", err)
	}

	// Write template.json (manifest only, no files field).
	manifest := openclawTemplateManifest{
		Name:        detail.Name,
		DisplayName: detail.DisplayName,
		Description: detail.Description,
		Version:     detail.Version,
		Agents:      detail.Agents,
		Workspace:   detail.Workspace,
		Middleware:  detail.Middleware,
		Theme:       detail.Theme,
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal template manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(templateDir, "template.json"), data, 0o644); err != nil {
		return fmt.Errorf("write template manifest: %w", err)
	}

	// Write files from the Files map.
	for relPath, content := range detail.Files {
		relPath = strings.TrimSpace(strings.ReplaceAll(relPath, "\\", "/"))
		if relPath == "template.json" {
			continue
		}
		if strings.Contains(relPath, "..") || filepath.IsAbs(relPath) {
			return fmt.Errorf("invalid file path in template: %q", relPath)
		}

		targetPath := filepath.Join(templateDir, filepath.FromSlash(relPath))
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return fmt.Errorf("mkdir for file %s: %w", relPath, err)
		}
		if err := os.WriteFile(targetPath, []byte(content), 0o644); err != nil {
			return fmt.Errorf("write file %s: %w", relPath, err)
		}
	}

	log.Info().Str("template", detail.Name).Str("version", detail.Version).Int("files", len(detail.Files)).Msg("template saved")
	return nil
}

// DeleteTemplate removes an entire template directory.
func (c *Client) DeleteTemplate(name string) error {
	if err := validateTemplateName(name); err != nil {
		return err
	}

	templatesDir, err := resolveTemplatesDir()
	if err != nil {
		return err
	}

	templateDir := filepath.Join(templatesDir, name)
	if _, err := os.Stat(templateDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%w: %s", ErrTemplateNotFound, name)
		}
		return fmt.Errorf("stat template dir: %w", err)
	}

	if err := os.RemoveAll(templateDir); err != nil {
		return fmt.Errorf("remove template dir %s: %w", name, err)
	}

	log.Info().Str("template", name).Msg("template deleted")
	return nil
}

// ── Template file operations ─────────────────────────────────

func (c *Client) copyTemplateFile(containerName, sourcePath, targetPath string) error {
	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("read source file %s: %w", sourcePath, err)
	}

	ctx := context.Background()
	if _, err := c.rt.Exec(ctx, containerName, "mkdir", "-p", path.Dir(targetPath)); err != nil {
		return fmt.Errorf("mkdir target dir: %w", err)
	}

	if err := c.rt.WriteFile(ctx, containerName, targetPath, data); err != nil {
		return fmt.Errorf("copy %s to %s: %w", sourcePath, targetPath, err)
	}

	return nil
}

func (c *Client) copyTemplateDir(containerName, sourceDir, targetRoot string) (int, error) {
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

	ctx := context.Background()
	if _, err := c.rt.Exec(ctx, containerName, "mkdir", "-p", targetRoot); err != nil {
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
			_, err := c.rt.Exec(ctx, containerName, "mkdir", "-p", targetPath)
			return err
		}

		if err := c.copyTemplateFile(containerName, filePath, targetPath); err != nil {
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

// ── Template installation ────────────────────────────────────

// InstallTemplate installs a team template into an existing OpenClaw container.
func (c *Client) InstallTemplate(ctx context.Context, info *store.ContainerInfo, templateName string) (*TemplateInstallResult, error) {
	if info == nil {
		return nil, fmt.Errorf("container info is required")
	}

	manifest, templateDir, err := c.loadTemplate(templateName)
	if err != nil {
		return nil, err
	}

	if err := c.EnsureRunning(ctx, info); err != nil {
		return nil, fmt.Errorf("ensure container running: %w", err)
	}

	workspaceRoot := manifest.workspaceRoot()
	if _, err := c.rt.Exec(ctx, info.ContainerName, "mkdir", "-p", workspaceRoot); err != nil {
		return nil, fmt.Errorf("mkdir workspace: %w", err)
	}

	filesCopied := 0
	for _, agentCfg := range manifest.Agents {
		if agentCfg.ID == "" {
			continue
		}

		agentDir := path.Join("/home/node/.openclaw/agents", agentCfg.ID)
		if _, err := c.rt.Exec(ctx, info.ContainerName, "mkdir", "-p", path.Join(agentDir, "skills")); err != nil {
			return nil, fmt.Errorf("mkdir agent dir %s: %w", agentCfg.ID, err)
		}

		if agentCfg.Prompt != "" {
			relPromptPath, err := normalizeTemplateRelativePath(agentCfg.Prompt)
			if err != nil {
				return nil, fmt.Errorf("invalid prompt path for agent %s: %w", agentCfg.ID, err)
			}
			sourcePrompt := filepath.Join(templateDir, filepath.FromSlash(relPromptPath))
			if err := c.copyTemplateFile(info.ContainerName, sourcePrompt, path.Join(agentDir, "prompt.md")); err != nil {
				return nil, err
			}
			filesCopied++
		}

		for _, skill := range agentCfg.Skills {
			sourceSkillDir := filepath.Join(templateDir, "skills", skill)
			n, err := c.copyTemplateDir(info.ContainerName, sourceSkillDir, path.Join(agentDir, "skills", skill))
			if err != nil {
				return nil, fmt.Errorf("copy skills for agent %s (%s): %w", agentCfg.ID, skill, err)
			}
			filesCopied += n
		}
	}

	if n, err := c.copyTemplateDir(info.ContainerName, filepath.Join(templateDir, "rules"), workspaceRoot); err != nil {
		return nil, fmt.Errorf("copy rules: %w", err)
	} else {
		filesCopied += n
	}

	if n, err := c.copyTemplateDir(info.ContainerName, filepath.Join(templateDir, "workspace"), workspaceRoot); err != nil {
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
		if err := c.copyTemplateFile(info.ContainerName, sourcePath, targetPath); err != nil {
			return nil, fmt.Errorf("copy workspace mapped file %s: %w", target, err)
		}
		filesCopied++
	}

	if c.store != nil {
		if err := c.store.SetContainerTemplate(ctx, info.UserID, info.ContainerType, manifest.Name); err != nil {
			return nil, fmt.Errorf("save container template: %w", err)
		}
	}

	configChanged, err := c.SyncConfig(ctx, info)
	if err != nil {
		return nil, fmt.Errorf("sync config with template: %w", err)
	}

	jmosConfigChanged, err := c.SyncJMOSConfig(info.ContainerName, info.UserID, info.ContainerToken)
	if err != nil {
		return nil, fmt.Errorf("sync jmos config with template: %w", err)
	}
	if jmosConfigChanged {
		if err := c.RestartJMOS(info.ContainerName); err != nil {
			return nil, fmt.Errorf("restart jmos after template install: %w", err)
		}
	}

	log.Info().Str("container", info.ContainerName).Str("template", manifest.Name).Int("files", filesCopied).Msg("openclaw template installed")

	return &TemplateInstallResult{
		Template:      manifest.Name,
		Container:     info.ContainerName,
		Workspace:     workspaceRoot,
		Agents:        len(buildTemplateAgents(manifest)),
		FilesCopied:   filesCopied,
		ConfigChanged: configChanged || jmosConfigChanged,
	}, nil
}
