package scheduler

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/task"
	"github.com/fran0220/jacoworks/gateway/internal/workflow"
)

const (
	tickInterval         = 5 * time.Second
	maxConcurrentDefault = 3
)

type Scheduler struct {
	taskStore   *task.Store
	workflowRun *workflow.Runner
	dispatcher  *Dispatcher
	watchdog    *Watchdog
	eventBus    *EventBus

	maxConcurrent int
}

func New(ts *task.Store, runner *workflow.Runner, d *Dispatcher, wd *Watchdog, bus *EventBus) *Scheduler {
	return &Scheduler{
		taskStore:     ts,
		workflowRun:   runner,
		dispatcher:    d,
		watchdog:      wd,
		eventBus:      bus,
		maxConcurrent: maxConcurrentDefault,
	}
}

func (s *Scheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()

	log.Info().Dur("interval", tickInterval).Msg("scheduler started")
	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("scheduler stopped")
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	if s.watchdog != nil {
		s.watchdog.CheckTimeouts(ctx)
	}
	if err := s.dispatchPending(ctx); err != nil {
		log.Warn().Err(err).Msg("scheduler: dispatch tick failed")
	}
}

func (s *Scheduler) dispatchPending(ctx context.Context) error {
	pending, err := s.taskStore.ListPending(ctx, 10)
	if err != nil {
		return err
	}

	for _, t := range pending {
		running, err := s.taskStore.CountRunning(ctx, t.UserID)
		if err != nil {
			log.Warn().Err(err).Str("user_id", t.UserID).Msg("scheduler: count running failed")
			continue
		}
		if running >= s.maxConcurrent {
			continue
		}

		if err := task.ValidateTransition(t.Status, task.StatusAssigned); err != nil {
			continue
		}
		if err := s.taskStore.UpdateStatus(ctx, t.ID, task.StatusAssigned, map[string]any{}); err != nil {
			log.Warn().Err(err).Str("task_id", t.ID).Msg("scheduler: assign failed")
			continue
		}

		s.publish(t.UserID, ActivityEvent{
			Kind:      "task_claim",
			TaskID:    t.ID,
			AgentID:   t.AgentName,
			AgentName: t.AgentName,
			Detail:    summarize(t.Prompt),
		})

		if err := s.dispatcher.Dispatch(ctx, &t); err != nil {
			log.Warn().Err(err).Str("task_id", t.ID).Msg("scheduler: dispatch failed")
			continue
		}

		s.publish(t.UserID, ActivityEvent{
			Kind:      "task_start",
			TaskID:    t.ID,
			AgentID:   t.AgentName,
			AgentName: t.AgentName,
			Detail:    summarize(t.Prompt),
		})
	}
	return nil
}

func (s *Scheduler) OnAgentEnd(ctx context.Context, userID, sessionKey string) {
	t, err := s.taskStore.FindRunningBySession(ctx, userID, sessionKey)
	if err != nil {
		return
	}
	if t.Status != task.StatusRunning {
		return
	}

	if err := s.taskStore.UpdateStatus(ctx, t.ID, task.StatusDone, map[string]any{
		"finished_at": time.Now().UTC(),
	}); err != nil {
		log.Warn().Err(err).Str("task_id", t.ID).Msg("scheduler: mark done failed")
		return
	}

	updated, err := s.taskStore.Get(ctx, userID, t.ID)
	if err != nil {
		return
	}

	s.publish(userID, ActivityEvent{
		Kind:      "task_complete",
		TaskID:    updated.ID,
		AgentID:   updated.AgentName,
		AgentName: updated.AgentName,
		Detail:    "",
	})

	if s.workflowRun != nil {
		if err := s.workflowRun.OnTaskDone(ctx, updated); err != nil {
			log.Warn().Err(err).Str("task_id", updated.ID).Msg("scheduler: workflow transition failed")
		}
	}
}

func (s *Scheduler) publish(userID string, event ActivityEvent) {
	if s.eventBus == nil {
		return
	}
	s.eventBus.Publish(userID, event)
}

func summarize(prompt string) string {
	if len(prompt) <= 60 {
		return prompt
	}
	return prompt[:57] + "..."
}
