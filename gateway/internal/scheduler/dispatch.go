package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/agent"
	"github.com/fran0220/jacoworks/gateway/internal/pi"
	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/fran0220/jacoworks/gateway/internal/task"
)

type Dispatcher struct {
	store   *store.Store
	backend agent.VMBackend
	task    *task.Store
}

func NewDispatcher(s *store.Store, backend agent.VMBackend, taskStore *task.Store) *Dispatcher {
	return &Dispatcher{store: s, backend: backend, task: taskStore}
}

func (d *Dispatcher) Dispatch(ctx context.Context, t *task.Task) error {
	logger := log.With().Str("task_id", t.ID).Str("agent", t.AgentName).Str("user_id", t.UserID).Logger()
	agentProfile := d.resolveAgent(ctx, t)
	harnessPrompt := d.buildHarnessPrompt(t, agentProfile)

	info, err := d.store.GetContainerInfo(ctx, t.UserID, store.ContainerTypePiVM)
	if err != nil {
		_ = d.task.UpdateStatus(ctx, t.ID, task.StatusFailed, map[string]any{
			"error":       "no container provisioned",
			"finished_at": time.Now().UTC(),
		})
		return fmt.Errorf("no container provisioned: %w", err)
	}

	if err := d.backend.EnsureRunning(ctx, info); err != nil {
		_ = d.task.UpdateStatus(ctx, t.ID, task.StatusFailed, map[string]any{
			"error":       fmt.Sprintf("container not ready: %v", err),
			"finished_at": time.Now().UTC(),
		})
		return fmt.Errorf("container not ready: %w", err)
	}

	if refreshed, err := d.store.GetContainerInfo(ctx, t.UserID, store.ContainerTypePiVM); err == nil {
		info = refreshed
	}

	if err := d.task.UpdateStatus(ctx, t.ID, task.StatusRunning, map[string]any{
		"agent_name": agentProfile.Name,
		"started_at": time.Now().UTC(),
	}); err != nil {
		logger.Warn().Err(err).Msg("dispatch: update running failed")
		return err
	}

	sessionKey := t.SessionID
	if sessionKey == "" {
		sessionKey = fmt.Sprintf("task:%s", t.ID)
		if err := d.task.UpdateStatus(ctx, t.ID, task.StatusRunning, map[string]any{"session_id": sessionKey}); err != nil {
			log.Debug().Err(err).Str("task_id", t.ID).Msg("dispatch: failed to persist generated session_id")
		}
	}

	piPayload, err := json.Marshal(map[string]any{
		"type":       "prompt",
		"session_id": sessionKey,
		"message":    harnessPrompt,
	})
	if err != nil {
		return fmt.Errorf("marshal prompt failed: %w", err)
	}

	if err := d.sendToPi(ctx, info, piPayload); err != nil {
		errMsg := fmt.Sprintf("send to pi failed: %v", err)
		logger.Warn().Err(err).Msg("dispatch: send failed")
		_ = d.task.UpdateStatus(ctx, t.ID, task.StatusFailed, map[string]any{
			"error":       errMsg,
			"finished_at": time.Now().UTC(),
		})
		return err
	}

	logger.Info().Str("session_key", sessionKey).Msg("dispatch: task sent to pi")
	return nil
}

func (d *Dispatcher) sendToPi(ctx context.Context, info *store.ContainerInfo, payload []byte) error {
	addr := d.backend.UpstreamAddr(info)
	if strings.TrimSpace(addr) == "" {
		return fmt.Errorf("upstream address empty")
	}

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, resp, err := dialer.DialContext(ctx, addr, nil)
	if err != nil {
		return fmt.Errorf("dial upstream: %w", err)
	}
	if resp != nil && resp.StatusCode != http.StatusSwitchingProtocols {
		return fmt.Errorf("upstream returned %d", resp.StatusCode)
	}
	defer conn.Close()

	_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		return fmt.Errorf("write to upstream: %w", err)
	}

	_ = conn.WriteControl(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		time.Now().Add(5*time.Second))

	return nil
}

type resolvedAgent struct {
	ID           string
	Name         string
	SystemPrompt string
}

func (d *Dispatcher) resolveAgent(ctx context.Context, t *task.Task) resolvedAgent {
	if profile := d.resolveProfileByName(ctx, t.UserID, t.AgentName); profile != nil {
		return resolvedAgent{
			ID:           profile.Name,
			Name:         profile.DisplayName,
			SystemPrompt: buildProfileSystemPrompt(profile),
		}
	}
	if profile := d.resolveProfileByType(ctx, t.UserID, t.Type); profile != nil {
		return resolvedAgent{
			ID:           profile.Name,
			Name:         profile.DisplayName,
			SystemPrompt: buildProfileSystemPrompt(profile),
		}
	}
	if preset := d.resolvePresetByType(t.Type); preset != nil {
		systemPrompt := ""
		if preset.SystemPrompt != nil {
			systemPrompt = strings.TrimSpace(*preset.SystemPrompt)
		}
		return resolvedAgent{
			ID:           preset.ID,
			Name:         preset.Label,
			SystemPrompt: systemPrompt,
		}
	}

	name := strings.TrimSpace(t.AgentName)
	if name == "" {
		name = defaultAgentNameByType(t.Type)
	}
	return resolvedAgent{Name: name, ID: name}
}

func (d *Dispatcher) resolveProfileByName(ctx context.Context, userID, name string) *store.AgentProfile {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	profile, err := d.store.GetAgentProfile(ctx, userID, name)
	if err != nil {
		return nil
	}
	return profile
}

func (d *Dispatcher) resolveProfileByType(ctx context.Context, userID, taskType string) *store.AgentProfile {
	profiles, err := d.store.ListAgentProfiles(ctx, userID)
	if err != nil {
		return nil
	}
	targetSkills := skillsByTaskType(taskType)
	for _, summary := range profiles {
		profile, err := d.store.GetAgentProfile(ctx, userID, summary.Name)
		if err != nil {
			continue
		}
		for _, skill := range profile.Skills {
			if slices.Contains(targetSkills, skill) {
				return profile
			}
		}
	}
	return nil
}

func (d *Dispatcher) resolvePresetByType(taskType string) *pi.AgentPreset {
	presets, err := pi.LoadAgentPresets()
	if err != nil {
		return nil
	}
	hints := presetHintsByTaskType(taskType)
	for _, preset := range presets {
		for _, hint := range hints {
			if strings.EqualFold(preset.ID, hint) || strings.Contains(strings.ToLower(preset.Label), hint) {
				return &preset
			}
		}
	}
	if len(presets) == 0 {
		return nil
	}
	return &presets[0]
}

func buildProfileSystemPrompt(profile *store.AgentProfile) string {
	parts := make([]string, 0, 2)
	if desc := strings.TrimSpace(profile.Description); desc != "" {
		parts = append(parts, desc)
	}
	if len(profile.Skills) > 0 {
		parts = append(parts, "Use these skills when relevant: "+strings.Join(profile.Skills, ", "))
	}
	return strings.Join(parts, "\n")
}

func defaultAgentNameByType(taskType string) string {
	switch strings.TrimSpace(strings.ToLower(taskType)) {
	case "research":
		return "researcher"
	case "document":
		return "writer"
	case "analysis":
		return "analyst"
	case "creative":
		return "creator"
	case "code":
		return "engineer"
	default:
		return "assistant"
	}
}

func skillsByTaskType(taskType string) []string {
	switch strings.TrimSpace(strings.ToLower(taskType)) {
	case "research":
		return []string{"search", "research", "analysis"}
	case "document":
		return []string{"writing", "document", "report"}
	case "analysis":
		return []string{"analysis", "data-analysis"}
	case "creative":
		return []string{"creative", "design", "content"}
	case "code":
		return []string{"coding", "programming", "development"}
	default:
		return []string{"chat"}
	}
}

func presetHintsByTaskType(taskType string) []string {
	switch strings.TrimSpace(strings.ToLower(taskType)) {
	case "research":
		return []string{"research", "analyst"}
	case "document":
		return []string{"writer", "document"}
	case "analysis":
		return []string{"analyst", "research"}
	case "creative":
		return []string{"creative", "writer"}
	case "code":
		return []string{"engineer", "coder", "developer"}
	default:
		return []string{"assistant", "default"}
	}
}

func (d *Dispatcher) buildHarnessPrompt(t *task.Task, agentProfile resolvedAgent) string {
	var builder strings.Builder
	if agentProfile.SystemPrompt != "" {
		builder.WriteString(agentProfile.SystemPrompt)
		builder.WriteString("\n\n")
	}
	builder.WriteString("Task metadata:\n")
	builder.WriteString("task_id: ")
	builder.WriteString(t.ID)
	builder.WriteString("\n")
	builder.WriteString("task_type: ")
	builder.WriteString(t.Type)
	builder.WriteString("\n")
	if t.WorkflowID != "" {
		builder.WriteString("workflow_id: ")
		builder.WriteString(t.WorkflowID)
		builder.WriteString("\n")
	}
	if t.Stage != "" {
		builder.WriteString("stage: ")
		builder.WriteString(t.Stage)
		builder.WriteString("\n")
	}
	builder.WriteString("\nTask prompt:\n")
	builder.WriteString(t.Prompt)
	return builder.String()
}
