package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/config"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type RuleService struct {
	db  *store.DB
	cfg *config.Config
}

func NewRuleService(db *store.DB, cfg *config.Config) *RuleService {
	return &RuleService{db: db, cfg: cfg}
}

var validScopes = map[string]bool{
	"global": true, "project": true, "task": true, "sub_task": true,
}

func (s *RuleService) CreateRule(ctx context.Context, scope, content, project, taskID, subTaskID string) (*model.Rule, error) {
	if !validScopes[scope] {
		return nil, &store.ValidationError{Message: "invalid scope: " + scope + ", must be one of: global, project, task, sub_task"}
	}
	if scope == "task" && taskID == "" {
		return nil, &store.ValidationError{Message: "task_id required for task-scoped rule"}
	}
	if scope == "sub_task" && subTaskID == "" {
		return nil, &store.ValidationError{Message: "sub_task_id required for sub_task-scoped rule"}
	}
	if scope == "project" && project == "" {
		return nil, &store.ValidationError{Message: "project required for project-scoped rule"}
	}

	now := time.Now().UTC()
	r := &model.Rule{
		ID:        uuid.NewString(),
		Scope:     scope,
		Content:   content,
		Project:   project,
		TaskID:    taskID,
		SubTaskID: subTaskID,
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	if err := s.db.InsertRule(ctx, r); err != nil {
		return nil, err
	}
	return r, nil
}

func (s *RuleService) UpdateRule(ctx context.Context, id, content string) error {
	return s.db.UpdateRule(ctx, id, content)
}

func (s *RuleService) DeleteRule(ctx context.Context, id string) error {
	return s.db.DeleteRule(ctx, id)
}

func (s *RuleService) ListRules(ctx context.Context, scope, project, taskID string) ([]*model.Rule, error) {
	return s.db.ListRules(ctx, scope, project, taskID)
}

func (s *RuleService) GetRule(ctx context.Context, id string) (*model.Rule, error) {
	return s.db.GetRuleByID(ctx, id)
}

// GetMergedRules returns merged rules with variable replacement.
func (s *RuleService) GetMergedRules(ctx context.Context, project, taskID, subTaskID string) (string, error) {
	merged, err := s.db.GetMergedRules(ctx, project, taskID, subTaskID)
	if err != nil {
		return "", err
	}
	return s.replaceVariables(merged), nil
}

func (s *RuleService) replaceVariables(content string) string {
	replacements := map[string]string{
		"{{workspace_root}}": s.cfg.Workspace.Root,
		"{{project_name}}":  s.cfg.Project.Name,
	}
	for k, v := range replacements {
		content = strings.ReplaceAll(content, k, v)
	}
	return content
}
