package pi

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/container"
)

const (
	defaultProxyURL = "http://67.230.182.59:8317"
	agentConfigDir  = "/home/node/.pi/agent"
)

type ConfigWriter struct {
	rt         container.Runtime
	getLLM     func() config.LLMConfig
	gatewayURL string
}

type AgentPreset struct {
	ID           string  `json:"id"`
	Label        string  `json:"label"`
	Icon         string  `json:"icon"`
	WorkspaceKey string  `json:"workspaceKey"`
	SpritePackId string  `json:"spritePackId,omitempty"`
	SystemPrompt *string `json:"systemPrompt"`
}

func NewConfigWriter(rt container.Runtime, getLLM func() config.LLMConfig, gatewayURL string) *ConfigWriter {
	return &ConfigWriter{rt: rt, getLLM: getLLM, gatewayURL: strings.TrimSpace(gatewayURL)}
}

func (w *ConfigWriter) WritePiConfig(ctx context.Context, containerName, gatewayToken string) error {
	if w == nil || w.rt == nil {
		return ErrPiMigrationPending
	}

	if _, err := w.rt.Exec(ctx, containerName, "bash", "-lc", "mkdir -p /home/node/.pi/agent/extensions /home/node/.pi/agent/skills /home/node/.pi/agent/team-templates /home/node/.pi/agent/crew-agents && chown -R node:node /home/node/.pi"); err != nil {
		return fmt.Errorf("prepare pi config dir: %w", err)
	}

	llm := config.LLMConfig{}
	if w.getLLM != nil {
		llm = w.getLLM()
	}

	modelsJSON, err := buildModelsJSON(llm)
	if err != nil {
		return err
	}
	settingsJSON, err := buildSettingsJSON(llm)
	if err != nil {
		return err
	}
	if err := w.rt.WriteFile(ctx, containerName, filepath.ToSlash(filepath.Join(agentConfigDir, "models.json")), modelsJSON); err != nil {
		return fmt.Errorf("write pi models.json: %w", err)
	}
	if err := w.rt.WriteFile(ctx, containerName, filepath.ToSlash(filepath.Join(agentConfigDir, "settings.json")), settingsJSON); err != nil {
		return fmt.Errorf("write pi settings.json: %w", err)
	}
	agentsJSON, err := readPiConfigSourceFile("agents.json")
	if err != nil {
		return err
	}
	if err := w.rt.WriteFile(ctx, containerName, filepath.ToSlash(filepath.Join(agentConfigDir, "agents.json")), agentsJSON); err != nil {
		return fmt.Errorf("write pi agents.json: %w", err)
	}
	piMessengerJSON, err := readPiConfigSourceFile("pi-messenger.json")
	if err != nil {
		return err
	}
	if err := w.rt.WriteFile(ctx, containerName, filepath.ToSlash(filepath.Join(agentConfigDir, "pi-messenger.json")), piMessengerJSON); err != nil {
		return fmt.Errorf("write pi pi-messenger.json: %w", err)
	}

	envData := []byte(renderRuntimeEnv(llm, w.gatewayURL, gatewayToken))
	if err := w.rt.WriteFile(ctx, containerName, filepath.ToSlash(filepath.Join(agentConfigDir, "runtime.env")), envData); err != nil {
		return fmt.Errorf("write pi runtime.env: %w", err)
	}

	extDir, err := resolvePiConfigSourcePath("extensions")
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(extDir)
	if err != nil {
		return fmt.Errorf("read pi extensions dir: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !isSupportedExtensionAsset(entry.Name()) {
			continue
		}
		content, err := os.ReadFile(filepath.Join(extDir, entry.Name()))
		if err != nil {
			return fmt.Errorf("read pi extension %s: %w", entry.Name(), err)
		}
		target := filepath.ToSlash(filepath.Join(agentConfigDir, "extensions", entry.Name()))
		if err := w.rt.WriteFile(ctx, containerName, target, content); err != nil {
			return fmt.Errorf("write pi extension %s: %w", entry.Name(), err)
		}
	}

	skillsDir, err := resolveSkillsSourcePath()
	if err != nil {
		return err
	}
	if _, err := w.rt.Exec(ctx, containerName, "bash", "-lc", "rm -rf /home/node/.pi/agent/skills/* && mkdir -p /home/node/.pi/agent/skills"); err != nil {
		return fmt.Errorf("reset pi skills dir: %w", err)
	}
	if err := syncDirectoryTree(ctx, w.rt, containerName, skillsDir, filepath.ToSlash(filepath.Join(agentConfigDir, "skills"))); err != nil {
		return err
	}

	templatesDir, err := resolvePiConfigSourcePath("team-templates")
	if err != nil {
		return err
	}
	if _, err := w.rt.Exec(ctx, containerName, "bash", "-lc", "rm -rf /home/node/.pi/agent/team-templates/* && mkdir -p /home/node/.pi/agent/team-templates"); err != nil {
		return fmt.Errorf("reset pi team templates dir: %w", err)
	}
	if err := syncDirectoryTree(ctx, w.rt, containerName, templatesDir, filepath.ToSlash(filepath.Join(agentConfigDir, "team-templates"))); err != nil {
		return err
	}

	crewAgentsDir, err := resolvePiConfigSourcePath("crew-agents")
	if err != nil {
		return err
	}
	if _, err := w.rt.Exec(ctx, containerName, "bash", "-lc", "rm -rf /home/node/.pi/agent/crew-agents/* && mkdir -p /home/node/.pi/agent/crew-agents"); err != nil {
		return fmt.Errorf("reset pi crew agents dir: %w", err)
	}
	if err := syncDirectoryTree(ctx, w.rt, containerName, crewAgentsDir, filepath.ToSlash(filepath.Join(agentConfigDir, "crew-agents"))); err != nil {
		return err
	}

	return nil
}

func isSupportedExtensionAsset(name string) bool {
	return strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".mjs")
}

func syncDirectoryTree(ctx context.Context, rt container.Runtime, containerName, sourceDir, targetDir string) error {
	return filepath.WalkDir(sourceDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return fmt.Errorf("walk %s: %w", sourceDir, walkErr)
		}
		if path == sourceDir {
			return nil
		}

		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return fmt.Errorf("resolve relative path for %s: %w", path, err)
		}
		targetPath := filepath.ToSlash(filepath.Join(targetDir, relPath))
		if entry.IsDir() {
			if _, err := rt.Exec(ctx, containerName, "mkdir", "-p", targetPath); err != nil {
				return fmt.Errorf("create pi directory %s: %w", filepath.ToSlash(relPath), err)
			}
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read pi asset %s: %w", filepath.ToSlash(relPath), err)
		}
		if err := rt.WriteFile(ctx, containerName, targetPath, content); err != nil {
			return fmt.Errorf("write pi asset %s: %w", filepath.ToSlash(relPath), err)
		}
		return nil
	})
}

func buildModelsJSON(llm config.LLMConfig) ([]byte, error) {
	templatePath, err := resolvePiConfigSourcePath("models.json")
	if err != nil {
		return nil, err
	}
	source, err := os.ReadFile(templatePath)
	if err != nil {
		return nil, fmt.Errorf("read pi models template: %w", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(source, &payload); err != nil {
		return nil, fmt.Errorf("parse pi models template: %w", err)
	}

	providers, _ := payload["providers"].(map[string]any)
	if providers == nil {
		providers = map[string]any{}
		payload["providers"] = providers
	}

	proxyURL := strings.TrimRight(strings.TrimSpace(llm.ProxyURL), "/")
	if proxyURL == "" {
		proxyURL = defaultProxyURL
	}
	proxyKey := strings.TrimSpace(llm.ProxyKey)
	if proxyKey == "" {
		proxyKey = "LLM_PROXY_KEY"
	}

	for name, rawProvider := range providers {
		provider, ok := rawProvider.(map[string]any)
		if !ok {
			continue
		}
		api, _ := provider["api"].(string)
		if api == "anthropic-messages" {
			provider["baseUrl"] = proxyURL
		} else {
			provider["baseUrl"] = proxyURL + "/v1"
			compat, _ := provider["compat"].(map[string]any)
			if compat == nil {
				compat = map[string]any{}
				provider["compat"] = compat
			}
			if _, exists := compat["supportsDeveloperRole"]; !exists {
				compat["supportsDeveloperRole"] = false
			}
			compat["supportsReasoningEffort"] = false
			if _, exists := compat["supportsStore"]; !exists {
				compat["supportsStore"] = false
			}
			if _, exists := compat["maxTokensField"]; !exists {
				compat["maxTokensField"] = "max_tokens"
			}
		}
		provider["apiKey"] = proxyKey
		providers[name] = provider
	}

	addProviderAlias(providers, "proxy-anthropic", "proxy-claude")
	addProviderAlias(providers, "proxy-openai", "proxy-gpt")

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal pi models config: %w", err)
	}
	return append(data, '\n'), nil
}

func buildSettingsJSON(llm config.LLMConfig) ([]byte, error) {
	templatePath, err := resolvePiConfigSourcePath("settings.json")
	if err != nil {
		return nil, err
	}
	source, err := os.ReadFile(templatePath)
	if err != nil {
		return nil, fmt.Errorf("read pi settings template: %w", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(source, &payload); err != nil {
		return nil, fmt.Errorf("parse pi settings template: %w", err)
	}

	if provider := normalizePrimaryProvider(llm.PrimaryProvider); provider != "" {
		payload["defaultProvider"] = provider
	}
	if model := normalizePrimaryModel(llm.PrimaryModel); model != "" {
		payload["defaultModel"] = model
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal pi settings config: %w", err)
	}
	return append(data, '\n'), nil
}

func LoadAgentPresets() ([]AgentPreset, error) {
	source, err := readPiConfigSourceFile("agents.json")
	if err != nil {
		return nil, err
	}

	var presets []AgentPreset
	if err := json.Unmarshal(source, &presets); err != nil {
		return nil, fmt.Errorf("parse pi agents template: %w", err)
	}

	normalized := make([]AgentPreset, 0, len(presets))
	for _, preset := range presets {
		preset.ID = strings.TrimSpace(preset.ID)
		preset.Label = strings.TrimSpace(preset.Label)
		preset.Icon = strings.TrimSpace(preset.Icon)
		preset.WorkspaceKey = strings.TrimSpace(preset.WorkspaceKey)
		preset.SpritePackId = strings.TrimSpace(preset.SpritePackId)
		if preset.ID == "" || preset.WorkspaceKey == "" {
			continue
		}
		if preset.Label == "" {
			preset.Label = preset.ID
		}
		if preset.Icon == "" {
			preset.Icon = "bot"
		}
		if preset.SystemPrompt != nil {
			prompt := strings.TrimSpace(*preset.SystemPrompt)
			if prompt == "" {
				preset.SystemPrompt = nil
			} else {
				preset.SystemPrompt = &prompt
			}
		}
		normalized = append(normalized, preset)
	}
	return normalized, nil
}

func renderRuntimeEnv(llm config.LLMConfig, gatewayURL, gatewayToken string) string {
	proxyURL := strings.TrimSpace(llm.ProxyURL)
	if proxyURL == "" {
		proxyURL = defaultProxyURL
	}
	gatewayURL = strings.TrimSpace(gatewayURL)
	if gatewayURL == "" {
		gatewayURL = "http://127.0.0.1:18700"
	}
	databaseURL := strings.TrimSpace(os.Getenv("GATEWAY_DATABASE_URL"))
	if databaseURL == "" {
		databaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}

	lines := []string{
		fmt.Sprintf("LLM_PROXY_URL=%s", shellEscapeEnvValue(proxyURL)),
		fmt.Sprintf("LLM_PROXY_KEY=%s", shellEscapeEnvValue(llm.ProxyKey)),
		fmt.Sprintf("FAL_API_KEY=%s", shellEscapeEnvValue(llm.FalAPIKey)),
		fmt.Sprintf("TAVILY_API_KEY=%s", shellEscapeEnvValue(llm.TavilyKey)),
		fmt.Sprintf("WS_WRAPPER_TOKEN=%s", shellEscapeEnvValue(gatewayToken)),
		fmt.Sprintf("GATEWAY_URL=%s", shellEscapeEnvValue(gatewayURL)),
		fmt.Sprintf("GATEWAY_TOKEN=%s", shellEscapeEnvValue(gatewayToken)),
	}
	if databaseURL != "" {
		lines = append(lines, fmt.Sprintf("DATABASE_URL=%s", shellEscapeEnvValue(databaseURL)))
	}
	return strings.Join(lines, "\n") + "\n"
}

func normalizePrimaryProvider(provider string) string {
	switch strings.TrimSpace(provider) {
	case "", "proxy-anthropic", "proxy-claude":
		return strings.TrimSpace(provider)
	case "proxy-openai", "proxy-gpt":
		return "proxy-gpt"
	default:
		return strings.TrimSpace(provider)
	}
}

func normalizePrimaryModel(model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	if _, after, ok := strings.Cut(model, "/"); ok {
		return strings.TrimSpace(after)
	}
	return model
}

func addProviderAlias(providers map[string]any, from, to string) {
	if _, exists := providers[to]; exists {
		return
	}
	raw, ok := providers[from]
	if !ok {
		return
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return
	}
	var clone map[string]any
	if json.Unmarshal(data, &clone) != nil {
		return
	}
	providers[to] = clone
}

func resolvePiConfigSourcePath(rel string) (string, error) {
	execPath, _ := os.Executable()
	execDir := filepath.Dir(execPath)
	candidates := []string{
		filepath.Join("pi-config", rel),
		filepath.Join("..", "pi-config", rel),
		filepath.Join(execDir, "pi-config", rel),
		filepath.Join(execDir, "..", "pi-config", rel),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%w: pi config asset not found: %s", os.ErrNotExist, rel)
}

func readPiConfigSourceFile(rel string) ([]byte, error) {
	path, err := resolvePiConfigSourcePath(rel)
	if err != nil {
		return nil, err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read pi config asset %s: %w", rel, err)
	}
	return content, nil
}

func resolveSkillsSourcePath() (string, error) {
	execPath, _ := os.Executable()
	execDir := filepath.Dir(execPath)
	candidates := []string{
		filepath.Join("skills"),
		filepath.Join("..", "skills"),
		filepath.Join(execDir, "skills"),
		filepath.Join(execDir, "..", "skills"),
		"/opt/jacoworks/skills",
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%w: skills asset not found", os.ErrNotExist)
}

func shellEscapeEnvValue(value string) string {
	if value == "" {
		return ""
	}
	return strings.ReplaceAll(value, "\n", "")
}
