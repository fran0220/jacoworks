package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/rs/zerolog/log"
)

// ── OpenClaw config JSON types ───────────────────────────────

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
	Mode           string            `json:"mode"`
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

// ── Config generation ────────────────────────────────────────

// GenerateConfig generates openclaw.json content as JSON bytes using hardcoded model list.
// Deprecated: Use GenerateConfigFromDB which reads providers/models from DB.
func (c *Client) GenerateConfig(token string, llm config.LLMConfig, hostPort int) ([]byte, error) {
	gatewayPort := c.resolveGatewayPort(hostPort)

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
					APIKey:  llm.ProxyKey,
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
			Mode: "local",
			Port: gatewayPort,
			Bind: "lan",
			Auth: openclawAuth{Mode: "token", Token: token},
			ControlUI: openclawControlUI{
				AllowedOrigins:               []string{"*"},
				DangerouslyDisableDeviceAuth: true,
			},
			TrustedProxies: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"},
		},
	}

	return json.MarshalIndent(cfg, "", "  ")
}

// GenerateConfigFromDB generates openclaw.json from DB-backed providers and models.
// Falls back to the hardcoded GenerateConfig if the DB query fails or returns no providers.
func (c *Client) GenerateConfigFromDB(ctx context.Context, userID, token string, hostPort int) ([]byte, error) {
	gatewayPort := c.resolveGatewayPort(hostPort)

	if c.store == nil {
		llm := c.getLLM()
		return c.GenerateConfig(token, llm, gatewayPort)
	}

	providers, err := c.store.ListProviders(ctx)
	if err != nil || len(providers) == 0 {
		if err != nil {
			log.Warn().Err(err).Msg("openclaw config: DB providers query failed, using hardcoded fallback")
		} else {
			log.Warn().Msg("openclaw config: no providers in DB, using hardcoded fallback")
		}
		llm := c.getLLM()
		data, genErr := c.GenerateConfig(token, llm, gatewayPort)
		if genErr != nil {
			return nil, genErr
		}
		return c.injectAgents(ctx, userID, data)
	}

	llm := c.getLLM()

	// Build providers map from DB
	ocProviders := make(map[string]openclawProvider)
	for _, p := range providers {
		if !p.Enabled {
			continue
		}

		models, err := c.store.ListModelsByProvider(ctx, p.Key)
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
		apiKey := llm.ProxyKey
		if p.APIKeyRef != "" && p.APIKeyRef != "llm_proxy_key" {
			if val, err := c.store.GetSetting(ctx, p.APIKeyRef); err == nil && val != "" {
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
		data, genErr := c.GenerateConfig(token, llm, gatewayPort)
		if genErr != nil {
			return nil, genErr
		}
		return c.injectAgents(ctx, userID, data)
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
			Mode: "local",
			Port: gatewayPort,
			Bind: "lan",
			Auth: openclawAuth{Mode: "token", Token: token},
			ControlUI: openclawControlUI{
				AllowedOrigins:               []string{"*"},
				DangerouslyDisableDeviceAuth: true,
			},
			TrustedProxies: []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8"},
		},
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return nil, err
	}
	return c.injectAgents(ctx, userID, data)
}

// injectAgents merges profile agents and template agents into the generated config.
// Profiles are always injected; template agents are added when a template is installed.
func (c *Client) injectAgents(ctx context.Context, userID string, data []byte) ([]byte, error) {
	// 1. Collect profile agents (always available)
	profileAgents := c.buildProfileAgents()

	// 2. Collect template agents (if template installed for this user)
	var templateAgents []openclawAgent
	if userID != "" && c.store != nil {
		templateName, err := c.store.GetContainerTemplate(ctx, userID, "openclaw")
		if err != nil {
			log.Warn().Err(err).Str("user_id", userID).Msg("openclaw config: failed to read container template")
		} else if templateName != "" {
			manifest, _, err := c.loadTemplate(templateName)
			if err != nil {
				log.Warn().Err(err).Str("template", templateName).Str("user_id", userID).Msg("openclaw config: template load failed")
			} else {
				templateAgents = buildTemplateAgents(manifest)
			}
		}
	}

	// 3. Merge: profiles first, then templates
	allAgents := make([]openclawAgent, 0, len(profileAgents)+len(templateAgents))
	allAgents = append(allAgents, profileAgents...)
	allAgents = append(allAgents, templateAgents...)

	if len(allAgents) == 0 {
		return data, nil
	}

	var cfg openclawConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("decode generated config for agent injection: %w", err)
	}
	cfg.Agents.List = allAgents
	return json.MarshalIndent(cfg, "", "  ")
}
