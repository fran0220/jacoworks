package workflow

import (
	"context"
	"fmt"
	"strings"

	taskpkg "github.com/fran0220/jacoworks/gateway/internal/task"
)

type Runner struct {
	workflowStore *Store
	taskStore     *taskpkg.Store
}

func NewRunner(ws *Store, ts *taskpkg.Store) *Runner {
	return &Runner{workflowStore: ws, taskStore: ts}
}

func (r *Runner) OnTaskDone(ctx context.Context, t *taskpkg.Task) error {
	if strings.TrimSpace(t.WorkflowID) == "" || strings.TrimSpace(t.Stage) == "" {
		return nil
	}

	wf, err := r.workflowStore.GetByUser(ctx, t.UserID, t.WorkflowID)
	if err != nil {
		return fmt.Errorf("load workflow %s: %w", t.WorkflowID, err)
	}
	if !wf.Enabled {
		return nil
	}

	currentStage := FindStage(wf.Stages, t.Stage)
	if currentStage == nil || strings.TrimSpace(currentStage.Next) == "" {
		return nil
	}

	nextStage := FindStage(wf.Stages, currentStage.Next)
	if nextStage == nil {
		return nil
	}

	prompt := renderTemplate(nextStage.PromptTemplate, map[string]string{
		"prev_result": valueOrEmpty(t.Result),
	})

	_, err = r.taskStore.Create(ctx, t.UserID, taskpkg.CreateTaskRequest{
		SessionID:  t.SessionID,
		WorkflowID: t.WorkflowID,
		Stage:      nextStage.Name,
		Type:       t.Type,
		AgentName:  nextStage.AgentName,
		Prompt:     prompt,
		Priority:   t.Priority,
		MaxRetries: t.MaxRetries,
		TimeoutSec: t.TimeoutSec,
	})
	if err != nil {
		return fmt.Errorf("create workflow next task (%s): %w", nextStage.Name, err)
	}
	return nil
}

func renderTemplate(tpl string, vars map[string]string) string {
	out := tpl
	for key, value := range vars {
		out = strings.ReplaceAll(out, "{{"+key+"}}", value)
	}
	return out
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
