package service

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type SubTaskService struct {
	db    *store.DB
	event *EventService
}

func NewSubTaskService(db *store.DB, event *EventService) *SubTaskService {
	return &SubTaskService{db: db, event: event}
}

// validTransitions defines the sub-task state machine.
var validTransitions = map[string][]string{
	"pending":     {"assigned"},
	"assigned":    {"in_progress", "pending"},
	"in_progress": {"review"},
	"review":      {"done", "rework"},
	"rework":      {"in_progress"},
	"blocked":     {"pending"},
	"done":        {},
	"cancelled":   {},
}

func isValidTransition(from, to string) bool {
	allowed, ok := validTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

// CreateSubTaskParams holds the input for creating a sub-task.
type CreateSubTaskParams struct {
	TaskID          string
	ModuleID        string
	Name            string
	Description     string
	Deliverable     string
	Acceptance      string
	Priority        string
	AssignedAgent   string
	Type            string
	EstimatedMinutes int
}

func (s *SubTaskService) CreateSubTask(ctx context.Context, p CreateSubTaskParams) (*model.SubTask, error) {
	// Validate task exists
	if _, err := s.db.GetTaskByID(ctx, p.TaskID); err != nil {
		return nil, err
	}

	// Validate module if specified
	if p.ModuleID != "" {
		mod, err := s.db.GetModuleByID(ctx, p.ModuleID)
		if err != nil {
			return nil, err
		}
		if mod.TaskID != p.TaskID {
			return nil, &store.ValidationError{Message: fmt.Sprintf("module %s does not belong to task %s", p.ModuleID, p.TaskID)}
		}
	}

	// Validate agent if specified
	if p.AssignedAgent != "" {
		if _, err := s.db.GetAgentByID(ctx, p.AssignedAgent); err != nil {
			return nil, err
		}
	}

	if p.Type == "" {
		p.Type = "once"
	}
	if p.Priority == "" {
		p.Priority = "medium"
	}

	initialStatus := "pending"
	if p.AssignedAgent != "" {
		initialStatus = "assigned"
	}

	now := time.Now().UTC()
	st := &model.SubTask{
		ID:               uuid.NewString(),
		TaskID:           p.TaskID,
		ModuleID:         p.ModuleID,
		Name:             p.Name,
		Description:      p.Description,
		Deliverable:      p.Deliverable,
		Acceptance:       p.Acceptance,
		Type:             p.Type,
		Status:           initialStatus,
		Priority:         p.Priority,
		AssignedAgent:    p.AssignedAgent,
		RecurringConfig:  "{}",
		Tags:             "[]",
		EstimatedMinutes: p.EstimatedMinutes,
		CreatedAt:        &now,
		UpdatedAt:        &now,
	}

	if err := s.db.InsertSubTask(ctx, st); err != nil {
		return nil, err
	}
	return st, nil
}

// SubTaskListResult is the paginated response.
type SubTaskListResult struct {
	Items []*model.SubTask `json:"items"`
	Total int              `json:"total"`
}

func (s *SubTaskService) ListSubTasks(ctx context.Context, taskID, moduleID, status, assignedAgent string, page, pageSize int, sortBy, sortOrder string) (*SubTaskListResult, error) {
	items, total, err := s.db.ListSubTasks(ctx, taskID, moduleID, status, assignedAgent, page, pageSize, sortBy, sortOrder)
	if err != nil {
		return nil, err
	}
	return &SubTaskListResult{Items: items, Total: total}, nil
}

func (s *SubTaskService) ListMySubTasks(ctx context.Context, agentID, status string, page, pageSize int) (*SubTaskListResult, error) {
	items, total, err := s.db.ListMySubTasks(ctx, agentID, status, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &SubTaskListResult{Items: items, Total: total}, nil
}

func (s *SubTaskService) ListAvailable(ctx context.Context, page, pageSize int) (*SubTaskListResult, error) {
	items, total, err := s.db.ListAvailableSubTasks(ctx, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &SubTaskListResult{Items: items, Total: total}, nil
}

func (s *SubTaskService) GetLatest(ctx context.Context, taskID, agentID string) (*model.SubTask, error) {
	return s.db.GetLatestSubTask(ctx, taskID, agentID)
}

func (s *SubTaskService) GetSubTask(ctx context.Context, id string) (*model.SubTask, error) {
	return s.db.GetSubTaskByID(ctx, id)
}

// ClaimSubTask transitions pending → assigned.
func (s *SubTaskService) ClaimSubTask(ctx context.Context, id, agentID, sessionID string) (*model.SubTask, error) {
	// Validate agent
	agent, err := s.db.GetAgentByID(ctx, agentID)
	if err != nil {
		return nil, err
	}

	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if !isValidTransition(st.Status, "assigned") {
		return nil, &store.ValidationError{Message: fmt.Sprintf("cannot claim: status %s → assigned not allowed", st.Status)}
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		extras := map[string]any{"assigned_agent": agentID}
		if sessionID != "" {
			extras["current_session_id"] = sessionID
		}
		if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "assigned", extras); err != nil {
			return err
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			ActorID:    agent.ID,
			ActorName:  agent.Name,
			ActorRole:  agent.Role,
			TaskID:     st.TaskID,
			SubTaskID:  id,
			SessionID:  sessionID,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "claim",
			FromStatus: st.Status,
			ToStatus:   "assigned",
			Summary:    fmt.Sprintf("%s claimed sub-task %q", agent.Name, st.Name),
		}); err != nil {
			return err
		}

		result = st
		result.Status = "assigned"
		result.AssignedAgent = agentID
		if sessionID != "" {
			result.CurrentSessionID = sessionID
		}
		return nil
	})
	return result, err
}

// StartSubTask transitions assigned/rework → in_progress.
func (s *SubTaskService) StartSubTask(ctx context.Context, id, sessionID string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if st.Status != "assigned" && st.Status != "rework" {
		return nil, &store.ValidationError{
			Message: fmt.Sprintf("cannot start: only assigned/rework can transition to in_progress, current: %s", st.Status),
		}
	}

	var agent *model.Agent
	if st.AssignedAgent != "" {
		agent, _ = s.db.GetAgentByID(ctx, st.AssignedAgent)
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		extras := map[string]any{}
		if sessionID != "" {
			extras["current_session_id"] = sessionID
		}
		// First start → record started_at
		if st.StartedAt == nil {
			extras["started_at"] = time.Now().UTC()
		}
		if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "in_progress", extras); err != nil {
			return err
		}

		actorID, actorName, actorRole := "", "", ""
		if agent != nil {
			actorID, actorName, actorRole = agent.ID, agent.Name, agent.Role
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			ActorID:    actorID,
			ActorName:  actorName,
			ActorRole:  actorRole,
			TaskID:     st.TaskID,
			SubTaskID:  id,
			SessionID:  sessionID,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "start",
			FromStatus: st.Status,
			ToStatus:   "in_progress",
			Summary:    fmt.Sprintf("%s started sub-task %q", actorName, st.Name),
		}); err != nil {
			return err
		}

		result = st
		result.Status = "in_progress"
		if sessionID != "" {
			result.CurrentSessionID = sessionID
		}
		return nil
	})
	return result, err
}

// SubmitSubTask transitions in_progress → review.
func (s *SubTaskService) SubmitSubTask(ctx context.Context, id string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if !isValidTransition(st.Status, "review") {
		return nil, &store.ValidationError{Message: fmt.Sprintf("cannot submit: status %s → review not allowed", st.Status)}
	}

	var agent *model.Agent
	if st.AssignedAgent != "" {
		agent, _ = s.db.GetAgentByID(ctx, st.AssignedAgent)
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "review", nil); err != nil {
			return err
		}

		actorID, actorName, actorRole := "", "", ""
		if agent != nil {
			actorID, actorName, actorRole = agent.ID, agent.Name, agent.Role
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			ActorID:    actorID,
			ActorName:  actorName,
			ActorRole:  actorRole,
			TaskID:     st.TaskID,
			SubTaskID:  id,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "submit",
			FromStatus: st.Status,
			ToStatus:   "review",
			Summary:    fmt.Sprintf("%s submitted sub-task %q for review", actorName, st.Name),
		}); err != nil {
			return err
		}

		result = st
		result.Status = "review"
		return nil
	})
	return result, err
}

// CompleteSubTaskTx transitions review → done within the given transaction.
// Used by ReviewService to complete within the same tx.
func (s *SubTaskService) CompleteSubTaskTx(ctx context.Context, tx *sql.Tx, id string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if !isValidTransition(st.Status, "done") {
		return nil, &store.ValidationError{Message: fmt.Sprintf("cannot complete: status %s → done not allowed", st.Status)}
	}

	now := time.Now().UTC()
	extras := map[string]any{
		"completed_at": now,
	}
	// Calculate actual_minutes if started_at is set
	if st.StartedAt != nil {
		actualMinutes := int(now.Sub(*st.StartedAt).Minutes())
		extras["actual_minutes"] = actualMinutes
	}

	if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "done", extras); err != nil {
		return nil, err
	}

	st.Status = "done"
	st.CompletedAt = &now
	return st, nil
}

// CompleteSubTask transitions review → done.
func (s *SubTaskService) CompleteSubTask(ctx context.Context, id string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if !isValidTransition(st.Status, "done") {
		return nil, &store.ValidationError{Message: fmt.Sprintf("cannot complete: status %s → done not allowed", st.Status)}
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		completed, err := s.CompleteSubTaskTx(ctx, tx, id)
		if err != nil {
			return err
		}

		var agent *model.Agent
		if st.AssignedAgent != "" {
			agent, _ = s.db.GetAgentByID(ctx, st.AssignedAgent)
		}
		actorID, actorName, actorRole := "", "", ""
		if agent != nil {
			actorID, actorName, actorRole = agent.ID, agent.Name, agent.Role
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			ActorID:    actorID,
			ActorName:  actorName,
			ActorRole:  actorRole,
			TaskID:     st.TaskID,
			SubTaskID:  id,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "approve",
			FromStatus: "review",
			ToStatus:   "done",
			Summary:    fmt.Sprintf("Sub-task %q completed", st.Name),
		}); err != nil {
			return err
		}

		result = completed
		return nil
	})
	return result, err
}

// ReworkSubTaskTx transitions review → rework within the given transaction.
func (s *SubTaskService) ReworkSubTaskTx(ctx context.Context, tx *sql.Tx, id, reworkAgent string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if !isValidTransition(st.Status, "rework") {
		return nil, &store.ValidationError{Message: fmt.Sprintf("cannot rework: status %s → rework not allowed", st.Status)}
	}

	extras := map[string]any{
		"rework_count": st.ReworkCount + 1,
	}
	if reworkAgent != "" {
		if _, err := s.db.GetAgentByID(ctx, reworkAgent); err != nil {
			return nil, err
		}
		extras["assigned_agent"] = reworkAgent
	}

	if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "rework", extras); err != nil {
		return nil, err
	}

	st.Status = "rework"
	st.ReworkCount++
	if reworkAgent != "" {
		st.AssignedAgent = reworkAgent
	}
	return st, nil
}

// ReworkSubTask transitions review → rework.
func (s *SubTaskService) ReworkSubTask(ctx context.Context, id, reworkAgent string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		reworked, err := s.ReworkSubTaskTx(ctx, tx, id, reworkAgent)
		if err != nil {
			return err
		}

		var agent *model.Agent
		if st.AssignedAgent != "" {
			agent, _ = s.db.GetAgentByID(ctx, st.AssignedAgent)
		}
		actorID, actorName, actorRole := "", "", ""
		if agent != nil {
			actorID, actorName, actorRole = agent.ID, agent.Name, agent.Role
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			ActorID:    actorID,
			ActorName:  actorName,
			ActorRole:  actorRole,
			TaskID:     st.TaskID,
			SubTaskID:  id,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "reject",
			FromStatus: "review",
			ToStatus:   "rework",
			Summary:    fmt.Sprintf("Sub-task %q sent back for rework", st.Name),
		}); err != nil {
			return err
		}

		result = reworked
		return nil
	})
	return result, err
}

// BlockSubTask transitions in_progress/assigned/rework → blocked.
func (s *SubTaskService) BlockSubTask(ctx context.Context, id string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if st.Status != "in_progress" && st.Status != "assigned" && st.Status != "rework" {
		return nil, &store.ValidationError{
			Message: fmt.Sprintf("cannot block: only in_progress/assigned/rework can be blocked, current: %s", st.Status),
		}
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		extras := map[string]any{"current_session_id": ""}
		if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "blocked", extras); err != nil {
			return err
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			TaskID:     st.TaskID,
			SubTaskID:  id,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "block",
			FromStatus: st.Status,
			ToStatus:   "blocked",
			Summary:    fmt.Sprintf("Sub-task %q blocked", st.Name),
		}); err != nil {
			return err
		}

		result = st
		result.Status = "blocked"
		result.CurrentSessionID = ""
		return nil
	})
	return result, err
}

// ReassignSubTask transitions blocked → assigned with a new agent.
func (s *SubTaskService) ReassignSubTask(ctx context.Context, id, agentID string) (*model.SubTask, error) {
	agent, err := s.db.GetAgentByID(ctx, agentID)
	if err != nil {
		return nil, err
	}

	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if st.Status != "blocked" {
		return nil, &store.ValidationError{Message: fmt.Sprintf("cannot reassign: only blocked sub-tasks can be reassigned, current: %s", st.Status)}
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		extras := map[string]any{
			"assigned_agent":     agentID,
			"current_session_id": "",
		}
		if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "assigned", extras); err != nil {
			return err
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			ActorID:    agent.ID,
			ActorName:  agent.Name,
			ActorRole:  agent.Role,
			TaskID:     st.TaskID,
			SubTaskID:  id,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "claim",
			FromStatus: "blocked",
			ToStatus:   "assigned",
			Summary:    fmt.Sprintf("Sub-task %q reassigned to %s", st.Name, agent.Name),
		}); err != nil {
			return err
		}

		result = st
		result.Status = "assigned"
		result.AssignedAgent = agentID
		result.CurrentSessionID = ""
		return nil
	})
	return result, err
}

// CancelSubTask cancels a non-terminal sub-task.
func (s *SubTaskService) CancelSubTask(ctx context.Context, id string) (*model.SubTask, error) {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	if st.Status == "done" || st.Status == "cancelled" {
		return nil, &store.ValidationError{Message: fmt.Sprintf("cannot cancel sub-task in %s status", st.Status)}
	}

	var result *model.SubTask
	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		extras := map[string]any{"current_session_id": ""}
		if err := s.db.UpdateSubTaskStatusTx(ctx, tx, id, "cancelled", extras); err != nil {
			return err
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "transition",
			TaskID:     st.TaskID,
			SubTaskID:  id,
			TargetType: "sub_task",
			TargetID:   id,
			TargetName: st.Name,
			Action:     "cancel",
			FromStatus: st.Status,
			ToStatus:   "cancelled",
			Summary:    fmt.Sprintf("Sub-task %q cancelled", st.Name),
		}); err != nil {
			return err
		}

		result = st
		result.Status = "cancelled"
		result.CurrentSessionID = ""
		return nil
	})
	return result, err
}

// UpdateSubTask edits sub-task fields. Only allowed in pending/assigned status.
func (s *SubTaskService) UpdateSubTask(ctx context.Context, id string, fields map[string]any) error {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return err
	}
	if st.Status != "pending" && st.Status != "assigned" {
		return &store.ValidationError{Message: fmt.Sprintf("sub-task can only be edited in pending/assigned status, current: %s", st.Status)}
	}
	return s.db.UpdateSubTask(ctx, id, fields)
}

// UpdateSession updates the current session ID. Only allowed in in_progress status.
func (s *SubTaskService) UpdateSession(ctx context.Context, id, sessionID string) error {
	st, err := s.db.GetSubTaskByID(ctx, id)
	if err != nil {
		return err
	}
	if st.Status != "in_progress" {
		return &store.ValidationError{Message: fmt.Sprintf("session can only be updated in in_progress status, current: %s", st.Status)}
	}
	return s.db.UpdateSubTask(ctx, id, map[string]any{"current_session_id": sessionID})
}
