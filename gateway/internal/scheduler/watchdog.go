package scheduler

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/task"
)

type Watchdog struct {
	taskStore *task.Store
	eventBus  *EventBus
}

func NewWatchdog(ts *task.Store, bus *EventBus) *Watchdog {
	return &Watchdog{taskStore: ts, eventBus: bus}
}

func (w *Watchdog) CheckTimeouts(ctx context.Context) {
	timedOut, err := w.taskStore.ListRunningTimedOut(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("watchdog: list timed out failed")
		return
	}

	for _, t := range timedOut {
		errMsg := "task timed out"
		if t.RetryCount < t.MaxRetries {
			if err := w.taskStore.UpdateStatus(ctx, t.ID, task.StatusTimeout, map[string]any{
				"error":       errMsg,
				"finished_at": time.Now().UTC(),
			}); err != nil {
				log.Warn().Err(err).Str("task_id", t.ID).Msg("watchdog: mark timeout failed")
				continue
			}
			w.publish(t.UserID, ActivityEvent{
				Kind:      "task_timeout",
				TaskID:    t.ID,
				AgentID:   t.AgentName,
				AgentName: t.AgentName,
				Detail:    errMsg,
			})
			if err := w.taskStore.UpdateStatus(ctx, t.ID, task.StatusPending, map[string]any{
				"retry_count": t.RetryCount + 1,
				"started_at":  nil,
				"finished_at": nil,
				"error":       "",
			}); err != nil {
				log.Warn().Err(err).Str("task_id", t.ID).Msg("watchdog: retry to pending failed")
			}
			continue
		}

		failMsg := "max retries exceeded"
		if err := w.taskStore.UpdateStatus(ctx, t.ID, task.StatusFailed, map[string]any{
			"error":       failMsg,
			"finished_at": time.Now().UTC(),
		}); err != nil {
			log.Warn().Err(err).Str("task_id", t.ID).Msg("watchdog: mark failed after retries failed")
			continue
		}

		w.publish(t.UserID, ActivityEvent{
			Kind:      "task_failed",
			TaskID:    t.ID,
			AgentID:   t.AgentName,
			AgentName: t.AgentName,
			Detail:    failMsg,
		})
	}
}

func (w *Watchdog) publish(userID string, event ActivityEvent) {
	if w.eventBus == nil {
		return
	}
	w.eventBus.Publish(userID, event)
}
