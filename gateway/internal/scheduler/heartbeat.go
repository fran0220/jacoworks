package scheduler

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/store"
	"github.com/fran0220/jacoworks/gateway/internal/task"
)

const (
	defaultHeartbeatInterval = 3 * time.Hour
	heartbeatSessionKey      = "team:yizhuang-life:heartbeat"
)

var morningPrompt = "早安！请各位开始今日工作：Rex 搜集亦庄今日美食推荐和新店动态，Pixel 整理今日电竞赛事和观赛信息，Nova 规划今日出行建议和天气提醒，Kael 发掘亦庄周边新鲜好去处，Zephyr 搜集今日热门活动和限时资讯。每人产出一份简短速报。"
var afternoonPrompt = "下午工作时间。请更新午间及下午时段的活动资讯，重点关注晚间可去的餐厅和娱乐活动。"
var eveningPrompt = "晚间速报时间。汇总今日精选内容，预告明日值得关注的活动和赛事。"

// Heartbeat sends periodic prompts to always-on team sessions.
type Heartbeat struct {
	taskStore  *task.Store
	dispatcher *Dispatcher
	store      *store.Store
	interval   time.Duration
	userID     string // resolved at start
}

func NewHeartbeat(ts *task.Store, d *Dispatcher, s *store.Store) *Heartbeat {
	return &Heartbeat{
		taskStore:  ts,
		dispatcher: d,
		store:      s,
		interval:   defaultHeartbeatInterval,
	}
}

func (h *Heartbeat) Start(ctx context.Context) {
	h.userID = h.resolveUserID(ctx)
	if h.userID == "" {
		log.Warn().Msg("heartbeat: no admin user found, disabled")
		return
	}
	log.Info().
		Str("user_id", h.userID).
		Dur("interval", h.interval).
		Str("session_key", heartbeatSessionKey).
		Msg("heartbeat started")

	// Fire immediately on startup if within working hours
	h.tick(ctx)

	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("heartbeat stopped")
			return
		case <-ticker.C:
			h.tick(ctx)
		}
	}
}

func (h *Heartbeat) tick(ctx context.Context) {
	prompt := h.promptForHour(time.Now().Hour())
	if prompt == "" {
		return // night hours, skip
	}

	t, err := h.taskStore.Create(ctx, h.userID, task.CreateTaskRequest{
		SessionID: heartbeatSessionKey,
		Type:      "chat",
		Prompt:    prompt,
	})
	if err != nil {
		log.Warn().Err(err).Msg("heartbeat: create task failed")
		return
	}
	log.Info().
		Str("task_id", t.ID).
		Str("session_key", heartbeatSessionKey).
		Msg("heartbeat: task created, will be dispatched by scheduler")
}

func (h *Heartbeat) promptForHour(hour int) string {
	switch {
	case hour >= 6 && hour < 12:
		return morningPrompt
	case hour >= 12 && hour < 18:
		return afternoonPrompt
	case hour >= 18 && hour < 24:
		return eveningPrompt
	default:
		return "" // 0-6: night, skip
	}
}

func (h *Heartbeat) resolveUserID(ctx context.Context) string {
	var id string
	err := h.store.Pool().QueryRow(ctx,
		`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
	).Scan(&id)
	if err != nil {
		log.Warn().Err(err).Msg("heartbeat: query admin user failed")
		return ""
	}
	return id
}
