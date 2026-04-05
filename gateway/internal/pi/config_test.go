package pi

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	configpkg "github.com/fran0220/jacoworks/gateway/internal/config"
	containerpkg "github.com/fran0220/jacoworks/gateway/internal/container"
)

func TestMain(m *testing.M) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		os.Exit(1)
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(filename), "../../.."))
	if err := os.Chdir(repoRoot); err != nil {
		panic(err)
	}
	os.Exit(m.Run())
}

func TestBuildModelsJSON_UsesLLMOverridesAndAddsAliases(t *testing.T) {
	t.Parallel()

	data, err := buildModelsJSON(configpkg.LLMConfig{
		ProxyURL: " https://proxy.example.com/base/ ",
		ProxyKey: " secret-key ",
	})
	if err != nil {
		t.Fatalf("buildModelsJSON() error = %v", err)
	}

	payload := decodeJSONMap(t, data)
	providers := nestedMap(t, payload, "providers")

	anthropic := nestedMap(t, providers, "proxy-anthropic")
	if got := stringValue(t, anthropic, "baseUrl"); got != "https://proxy.example.com/base" {
		t.Fatalf("proxy-anthropic baseUrl = %q, want %q", got, "https://proxy.example.com/base")
	}
	if got := stringValue(t, anthropic, "apiKey"); got != "secret-key" {
		t.Fatalf("proxy-anthropic apiKey = %q, want %q", got, "secret-key")
	}

	openAI := nestedMap(t, providers, "proxy-openai")
	if got := stringValue(t, openAI, "baseUrl"); got != "https://proxy.example.com/base/v1" {
		t.Fatalf("proxy-openai baseUrl = %q, want %q", got, "https://proxy.example.com/base/v1")
	}
	if got := stringValue(t, openAI, "apiKey"); got != "secret-key" {
		t.Fatalf("proxy-openai apiKey = %q, want %q", got, "secret-key")
	}
	compat := nestedMap(t, openAI, "compat")
	if got := boolValue(t, compat, "supportsDeveloperRole"); got {
		t.Fatalf("supportsDeveloperRole = %v, want false", got)
	}
	if got := boolValue(t, compat, "supportsReasoningEffort"); got {
		t.Fatalf("supportsReasoningEffort = %v, want false", got)
	}
	if got := boolValue(t, compat, "supportsStore"); got {
		t.Fatalf("supportsStore = %v, want false", got)
	}
	if got := stringValue(t, compat, "maxTokensField"); got != "max_tokens" {
		t.Fatalf("maxTokensField = %q, want %q", got, "max_tokens")
	}

	if !reflect.DeepEqual(nestedMap(t, providers, "proxy-claude"), anthropic) {
		t.Fatalf("proxy-claude alias does not match proxy-anthropic")
	}
	if !reflect.DeepEqual(nestedMap(t, providers, "proxy-gpt"), openAI) {
		t.Fatalf("proxy-gpt alias does not match proxy-openai")
	}
	if !strings.HasSuffix(string(data), "\n") {
		t.Fatalf("models JSON should end with newline")
	}
}

func TestBuildModelsJSON_UsesDefaultsWhenLLMConfigEmpty(t *testing.T) {
	t.Parallel()

	data, err := buildModelsJSON(configpkg.LLMConfig{})
	if err != nil {
		t.Fatalf("buildModelsJSON() error = %v", err)
	}

	payload := decodeJSONMap(t, data)
	providers := nestedMap(t, payload, "providers")

	anthropic := nestedMap(t, providers, "proxy-anthropic")
	if got := stringValue(t, anthropic, "baseUrl"); got != defaultProxyURL {
		t.Fatalf("proxy-anthropic baseUrl = %q, want %q", got, defaultProxyURL)
	}
	if got := stringValue(t, anthropic, "apiKey"); got != "LLM_PROXY_KEY" {
		t.Fatalf("proxy-anthropic apiKey = %q, want %q", got, "LLM_PROXY_KEY")
	}

	gemini := nestedMap(t, providers, "proxy-gemini")
	if got := stringValue(t, gemini, "baseUrl"); got != defaultProxyURL+"/v1" {
		t.Fatalf("proxy-gemini baseUrl = %q, want %q", got, defaultProxyURL+"/v1")
	}
	if got := stringValue(t, gemini, "apiKey"); got != "LLM_PROXY_KEY" {
		t.Fatalf("proxy-gemini apiKey = %q, want %q", got, "LLM_PROXY_KEY")
	}
}

func TestBuildSettingsJSON_PreservesTemplateDefaultsWhenUnset(t *testing.T) {
	t.Parallel()

	template := decodeJSONMapFromFile(t, "pi-config/settings.json")
	data, err := buildSettingsJSON(configpkg.LLMConfig{})
	if err != nil {
		t.Fatalf("buildSettingsJSON() error = %v", err)
	}

	payload := decodeJSONMap(t, data)
	if got := stringValue(t, payload, "defaultProvider"); got != stringValue(t, template, "defaultProvider") {
		t.Fatalf("defaultProvider = %q, want template default %q", got, stringValue(t, template, "defaultProvider"))
	}
	if got := stringValue(t, payload, "defaultModel"); got != stringValue(t, template, "defaultModel") {
		t.Fatalf("defaultModel = %q, want template default %q", got, stringValue(t, template, "defaultModel"))
	}
	if !strings.HasSuffix(string(data), "\n") {
		t.Fatalf("settings JSON should end with newline")
	}
}

func TestBuildSettingsJSON_OverridesProviderAndModel(t *testing.T) {
	t.Parallel()

	data, err := buildSettingsJSON(configpkg.LLMConfig{
		PrimaryProvider: " proxy-openai ",
		PrimaryModel:    "proxy-claude/claude-opus-4-6",
	})
	if err != nil {
		t.Fatalf("buildSettingsJSON() error = %v", err)
	}

	payload := decodeJSONMap(t, data)
	if got := stringValue(t, payload, "defaultProvider"); got != "proxy-gpt" {
		t.Fatalf("defaultProvider = %q, want %q", got, "proxy-gpt")
	}
	if got := stringValue(t, payload, "defaultModel"); got != "claude-opus-4-6" {
		t.Fatalf("defaultModel = %q, want %q", got, "claude-opus-4-6")
	}
}

func TestNormalizePrimaryProvider(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "keeps anthropic alias", input: "proxy-claude", want: "proxy-claude"},
		{name: "keeps anthropic canonical", input: "proxy-anthropic", want: "proxy-anthropic"},
		{name: "maps openai to gpt", input: "proxy-openai", want: "proxy-gpt"},
		{name: "keeps gpt", input: "proxy-gpt", want: "proxy-gpt"},
		{name: "trims custom provider", input: " custom-provider ", want: "custom-provider"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizePrimaryProvider(tt.input); got != tt.want {
				t.Fatalf("normalizePrimaryProvider(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestNormalizePrimaryModel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "trims whitespace", input: " claude-sonnet-4-6 ", want: "claude-sonnet-4-6"},
		{name: "strips provider prefix", input: "proxy-claude/claude-opus-4-6", want: "claude-opus-4-6"},
		{name: "strips provider prefix and trims remainder", input: "proxy-gpt/ gpt-5.4 ", want: "gpt-5.4"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizePrimaryModel(tt.input); got != tt.want {
				t.Fatalf("normalizePrimaryModel(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestRenderRuntimeEnv_RendersAllFieldsAndDefaults(t *testing.T) {
	t.Parallel()

	llm := configpkg.LLMConfig{
		ProxyURL:  "https://proxy.example.com/v1\n",
		ProxyKey:  "proxy-key\n",
		FalAPIKey: "fal-key\n",
		TavilyKey: "tavily-key\n",
	}

	got := renderRuntimeEnv(llm, " https://gateway.example.com \n", "ticket\nline")
	want := strings.Join([]string{
		"LLM_PROXY_URL=https://proxy.example.com/v1",
		"LLM_PROXY_KEY=proxy-key",
		"FAL_API_KEY=fal-key",
		"TAVILY_API_KEY=tavily-key",
		"WS_WRAPPER_TOKEN=ticketline",
		"GATEWAY_URL=https://gateway.example.com",
		"GATEWAY_TOKEN=ticketline",
		"",
	}, "\n")
	if got != want {
		t.Fatalf("renderRuntimeEnv() = %q, want %q", got, want)
	}

	defaults := renderRuntimeEnv(configpkg.LLMConfig{}, "", "")
	if !strings.Contains(defaults, "LLM_PROXY_URL="+defaultProxyURL+"\n") {
		t.Fatalf("renderRuntimeEnv() missing default proxy URL: %q", defaults)
	}
	if !strings.Contains(defaults, "GATEWAY_URL=http://127.0.0.1:18700\n") {
		t.Fatalf("renderRuntimeEnv() missing default gateway URL: %q", defaults)
	}
}

func TestAddProviderAlias_ClonesAndDoesNotOverwriteExisting(t *testing.T) {
	t.Parallel()

	providers := map[string]any{
		"source": map[string]any{
			"api":    "openai-completions",
			"compat": map[string]any{"supportsStore": false},
		},
	}

	addProviderAlias(providers, "source", "alias")
	alias := nestedMap(t, providers, "alias")
	if !reflect.DeepEqual(alias, providers["source"]) {
		t.Fatalf("alias = %#v, want deep-equal source %#v", alias, providers["source"])
	}

	source := nestedMap(t, providers, "source")
	nestedMap(t, source, "compat")["supportsStore"] = true
	if boolValue(t, nestedMap(t, alias, "compat"), "supportsStore") {
		t.Fatalf("alias should be a deep clone and remain unchanged")
	}

	providers["existing"] = map[string]any{"api": "existing"}
	addProviderAlias(providers, "source", "existing")
	if got := stringValue(t, nestedMap(t, providers, "existing"), "api"); got != "existing" {
		t.Fatalf("existing alias target was overwritten: api = %q", got)
	}
	addProviderAlias(providers, "missing", "unused")
	if _, exists := providers["unused"]; exists {
		t.Fatalf("missing source should not create alias")
	}
}

func TestWritePiConfig_SyncsSkillsRecursively(t *testing.T) {
	rt := &recordingRuntime{files: make(map[string][]byte)}
	writer := NewConfigWriter(rt, func() configpkg.LLMConfig { return configpkg.LLMConfig{} }, "https://gateway.example.com")

	if err := writer.WritePiConfig(context.Background(), "oc-test", "gateway-token"); err != nil {
		t.Fatalf("WritePiConfig() error = %v", err)
	}

	if !rt.hasExec("bash", "-lc", "rm -rf /home/node/.pi/agent/skills/* && mkdir -p /home/node/.pi/agent/skills") {
		t.Fatalf("WritePiConfig() did not reset the VM skills directory")
	}
	if !rt.hasExec("mkdir", "-p", "/home/node/.pi/agent/skills/search/scripts") {
		t.Fatalf("WritePiConfig() did not create nested skills directory for scripts")
	}
	if !rt.hasExec("mkdir", "-p", "/home/node/.pi/agent/skills/办公/data-analysis") {
		t.Fatalf("WritePiConfig() did not preserve nested unicode skill directories")
	}

	assertSyncedFile(t, rt, "skills/README.md")
	assertSyncedFile(t, rt, "skills/team-builder/SKILL.md")
	assertSyncedFile(t, rt, "skills/search/scripts/search.py")
	assertSyncedFile(t, rt, "skills/办公/data-analysis/SKILL.md")
	assertSyncedFile(t, rt, "skills/创作/slide-deck/requirements.txt")
	assertSyncedTargetFile(t, rt, "pi-config/extensions/cron-proxy.ts", filepath.ToSlash(filepath.Join(agentConfigDir, "extensions", "cron-proxy.ts")))
}

func TestShellEscapeEnvValue(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "empty", input: "", want: ""},
		{name: "unchanged", input: "plain-value", want: "plain-value"},
		{name: "removes newlines", input: "line1\nline2\n", want: "line1line2"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := shellEscapeEnvValue(tt.input); got != tt.want {
				t.Fatalf("shellEscapeEnvValue(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func decodeJSONMap(t *testing.T, data []byte) map[string]any {
	t.Helper()

	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	return payload
}

func decodeJSONMapFromFile(t *testing.T, path string) map[string]any {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("os.ReadFile(%q) error = %v", path, err)
	}
	return decodeJSONMap(t, data)
}

func nestedMap(t *testing.T, payload map[string]any, key string) map[string]any {
	t.Helper()

	raw, ok := payload[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}
	value, ok := raw.(map[string]any)
	if !ok {
		t.Fatalf("key %q has type %T, want map[string]any", key, raw)
	}
	return value
}

func stringValue(t *testing.T, payload map[string]any, key string) string {
	t.Helper()

	raw, ok := payload[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}
	value, ok := raw.(string)
	if !ok {
		t.Fatalf("key %q has type %T, want string", key, raw)
	}
	return value
}

func boolValue(t *testing.T, payload map[string]any, key string) bool {
	t.Helper()

	raw, ok := payload[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}
	value, ok := raw.(bool)
	if !ok {
		t.Fatalf("key %q has type %T, want bool", key, raw)
	}
	return value
}

type recordingRuntime struct {
	execCalls [][]string
	files     map[string][]byte
}

func (r *recordingRuntime) Create(context.Context, containerpkg.InstanceSpec) error { return nil }
func (r *recordingRuntime) Start(context.Context, string) error                     { return nil }
func (r *recordingRuntime) Stop(context.Context, string) error                      { return nil }
func (r *recordingRuntime) Restart(context.Context, string) error                   { return nil }
func (r *recordingRuntime) Freeze(context.Context, string) error                    { return nil }
func (r *recordingRuntime) Unfreeze(context.Context, string) error                  { return nil }
func (r *recordingRuntime) Unpause(context.Context, string) error                   { return nil }
func (r *recordingRuntime) Remove(context.Context, string) error                    { return nil }
func (r *recordingRuntime) Status(context.Context, string) (*containerpkg.ContainerInfo, error) {
	return nil, nil
}
func (r *recordingRuntime) List(context.Context) ([]containerpkg.ContainerInfo, error) {
	return nil, nil
}

func (r *recordingRuntime) Exec(_ context.Context, _ string, cmd ...string) (*containerpkg.ExecResult, error) {
	r.execCalls = append(r.execCalls, append([]string(nil), cmd...))
	return &containerpkg.ExecResult{}, nil
}

func (r *recordingRuntime) WriteFile(_ context.Context, _ string, path string, content []byte) error {
	r.files[path] = append([]byte(nil), content...)
	return nil
}

func (r *recordingRuntime) ReadFile(context.Context, string, string) (string, error) { return "", nil }
func (r *recordingRuntime) Logs(context.Context, string, int) (string, error)        { return "", nil }
func (r *recordingRuntime) WaitForHealth(context.Context, string, string, time.Duration) error {
	return nil
}

func (r *recordingRuntime) hasExec(want ...string) bool {
	for _, call := range r.execCalls {
		if reflect.DeepEqual(call, want) {
			return true
		}
	}
	return false
}

func assertSyncedFile(t *testing.T, rt *recordingRuntime, sourcePath string) {
	t.Helper()

	targetPath := filepath.ToSlash(filepath.Join(agentConfigDir, sourcePath))
	assertSyncedTargetFile(t, rt, sourcePath, targetPath)
}

func assertSyncedTargetFile(t *testing.T, rt *recordingRuntime, sourcePath, targetPath string) {
	t.Helper()

	want, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatalf("os.ReadFile(%q) error = %v", sourcePath, err)
	}
	got, ok := rt.files[targetPath]
	if !ok {
		t.Fatalf("missing synced file %q", targetPath)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("synced file %q did not match source contents", targetPath)
	}
}
