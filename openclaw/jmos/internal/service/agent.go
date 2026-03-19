package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type AgentService struct {
	db *store.DB
}

func NewAgentService(db *store.DB) *AgentService {
	return &AgentService{db: db}
}

var validAgentRoles = map[string]bool{
	"planner": true, "executor": true, "reviewer": true, "patrol": true,
}

var validAgentStatuses = map[string]bool{
	"idle": true, "thinking": true, "working": true,
	"reviewing": true, "scanning": true, "offline": true,
}

func generateAPIKey() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "ak_" + hex.EncodeToString(b), nil
}

// RegisterAgent creates a new agent with a generated API key.
func (s *AgentService) RegisterAgent(ctx context.Context, name, role, description string) (*model.Agent, error) {
	if !validAgentRoles[role] {
		return nil, &store.ValidationError{Message: "invalid role: " + role}
	}

	existing, err := s.db.GetAgentByName(ctx, name)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		// Idempotent: return existing agent (with API key) instead of error
		return existing, nil
	}

	apiKey, err := generateAPIKey()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	agent := &model.Agent{
		ID:          uuid.NewString(),
		Name:        name,
		Role:        role,
		Description: description,
		Status:      "idle",
		APIKey:      apiKey,
		CreatedAt:   &now,
	}
	if err := s.db.InsertAgent(ctx, agent); err != nil {
		return nil, err
	}
	return agent, nil
}

// ListAgents returns agents filtered by role and status.
func (s *AgentService) ListAgents(ctx context.Context, role, status string) ([]*model.Agent, error) {
	return s.db.ListAgents(ctx, role, status)
}

// UpdateStatus validates the status and updates the agent.
func (s *AgentService) UpdateStatus(ctx context.Context, id, status string) error {
	if !validAgentStatuses[status] {
		return &store.ValidationError{Message: "invalid agent status: " + status}
	}
	return s.db.UpdateAgentStatus(ctx, id, status)
}

// PulseRequest holds the heartbeat payload.
type PulseRequest struct {
	State     string `json:"state"`
	Action    string `json:"action"`
	SubTaskID string `json:"sub_task_id"`
	SessionID string `json:"session_id"`
}

// UpdatePulse updates agent heartbeat fields. Only emits an event when status changes.
func (s *AgentService) UpdatePulse(ctx context.Context, id string, req PulseRequest) (statusChanged bool, err error) {
	if req.State != "" && !validAgentStatuses[req.State] {
		return false, &store.ValidationError{Message: "invalid agent state: " + req.State}
	}

	// Get current agent to detect status change
	agent, err := s.db.GetAgentByID(ctx, id)
	if err != nil {
		return false, err
	}

	state := req.State
	if state == "" {
		state = agent.Status
	}

	statusChanged = state != agent.Status

	err = s.db.UpdateAgentPulse(ctx, id, state, req.Action, req.SubTaskID, req.SessionID)
	return statusChanged, err
}

// ResetAPIKey generates a new API key for the agent and returns it.
func (s *AgentService) ResetAPIKey(ctx context.Context, id string) (string, error) {
	// Verify agent exists
	if _, err := s.db.GetAgentByID(ctx, id); err != nil {
		return "", err
	}

	newKey, err := generateAPIKey()
	if err != nil {
		return "", err
	}
	if err := s.db.ResetAgentAPIKey(ctx, id, newKey); err != nil {
		return "", err
	}
	return newKey, nil
}
