package service

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type PatrolService struct {
	db    *store.DB
	event *EventService
}

func NewPatrolService(db *store.DB, event *EventService) *PatrolService {
	return &PatrolService{db: db, event: event}
}

// nullableFK returns nil for empty strings to avoid FK constraint failures in SQLite.
func nullableFK(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ReportPatrol creates a patrol record and publishes an event.
func (s *PatrolService) ReportPatrol(ctx context.Context, patrolType, severity, subTaskID, agentID, description, actionTaken string) (*model.PatrolRecord, error) {
	now := time.Now().UTC()
	record := &model.PatrolRecord{
		ID:          uuid.NewString(),
		Type:        patrolType,
		Severity:    severity,
		SubTaskID:   subTaskID,
		AgentID:     agentID,
		Description: description,
		ActionTaken: actionTaken,
		Status:      "open",
		CreatedAt:   &now,
	}

	var agent *model.Agent
	if agentID != "" {
		agent, _ = s.db.GetAgentByID(ctx, agentID)
	}

	err := s.db.WithTx(ctx, func(tx *sql.Tx) error {
		// Use tx directly to avoid deadlock (MaxOpenConns=1)
		subTaskIDVal := nullableFK(record.SubTaskID)
		agentIDVal := nullableFK(record.AgentID)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO patrol_record (id, type, severity, sub_task_id, agent_id, description, action_taken, status, created_at, resolved_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?)`,
			record.ID, record.Type, record.Severity, subTaskIDVal, agentIDVal, record.Description,
			record.ActionTaken, record.Status, record.CreatedAt, record.ResolvedAt,
		); err != nil {
			return err
		}

		actorID, actorName, actorRole := "", "", ""
		if agent != nil {
			actorID, actorName, actorRole = agent.ID, agent.Name, agent.Role
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "patrol",
			ActorID:    actorID,
			ActorName:  actorName,
			ActorRole:  actorRole,
			SubTaskID:  subTaskID,
			TargetType: "sub_task",
			TargetID:   subTaskID,
			Action:     "alert",
			Summary:    description,
		}); err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return record, nil
}

// PatrolListResult is the paginated response.
type PatrolListResult struct {
	Items []*model.PatrolRecord `json:"items"`
	Total int                   `json:"total"`
}

func (s *PatrolService) ListPatrols(ctx context.Context, status string, page, pageSize int) (*PatrolListResult, error) {
	items, total, err := s.db.ListPatrolRecords(ctx, status, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &PatrolListResult{Items: items, Total: total}, nil
}

func (s *PatrolService) ListActivePatrols(ctx context.Context) ([]*model.PatrolRecord, error) {
	return s.db.ListActivePatrols(ctx)
}

func (s *PatrolService) ResolvePatrol(ctx context.Context, id string) error {
	now := time.Now().UTC()
	return s.db.UpdatePatrolStatus(ctx, id, "resolved", &now)
}
