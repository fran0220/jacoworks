package service

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type EventService struct {
	db *store.DB
}

func NewEventService(db *store.DB) *EventService {
	return &EventService{db: db}
}

// EventVisual holds the frontend animation hints.
type EventVisual struct {
	ParticleColor string  `json:"particleColor,omitempty"`
	Trail         string  `json:"trail,omitempty"`
	Intensity     float64 `json:"intensity,omitempty"`
	Sound         string  `json:"sound,omitempty"`
	Glow          bool    `json:"glow,omitempty"`
}

var visualPresets = map[string]EventVisual{
	"claim":   {ParticleColor: "#00ff88", Trail: "task→agent", Intensity: 0.6, Sound: "claim"},
	"start":   {ParticleColor: "#00aaff", Glow: true, Intensity: 0.7},
	"submit":  {ParticleColor: "#ffaa00", Trail: "agent→reviewer", Intensity: 0.8, Sound: "submit"},
	"approve": {ParticleColor: "#00ff88", Glow: true, Intensity: 1.0, Sound: "approve"},
	"reject":  {ParticleColor: "#ff4444", Trail: "reviewer→agent", Intensity: 0.9, Sound: "reject"},
	"block":   {ParticleColor: "#ff4444", Glow: true, Intensity: 1.0, Sound: "alert"},
}

// PublishParams describes the event to publish.
type PublishParams struct {
	Project    string
	Type       string // transition, review, patrol, score, system
	ActorID    string
	ActorName  string
	ActorRole  string
	TaskID     string
	SubTaskID  string
	SessionID  string
	TargetType string // task, sub_task, agent
	TargetID   string
	TargetName string
	Action     string
	FromStatus string
	ToStatus   string
	Summary    string
	Payload    string // JSON string
}

// Publish inserts an event within the given transaction. It auto-fills visual presets by action.
func (s *EventService) Publish(ctx context.Context, tx store.DBTX, p PublishParams) (int64, error) {
	visualJSON := "{}"
	if preset, ok := visualPresets[p.Action]; ok {
		if b, err := json.Marshal(preset); err == nil {
			visualJSON = string(b)
		}
	}

	if p.Payload == "" {
		p.Payload = "{}"
	}

	event := &model.Event{
		EventID:    uuid.NewString(),
		Project:    p.Project,
		Type:       p.Type,
		ActorID:    p.ActorID,
		ActorName:  p.ActorName,
		ActorRole:  p.ActorRole,
		TaskID:     p.TaskID,
		SubTaskID:  p.SubTaskID,
		SessionID:  p.SessionID,
		TargetType: p.TargetType,
		TargetID:   p.TargetID,
		TargetName: p.TargetName,
		Action:     p.Action,
		FromStatus: p.FromStatus,
		ToStatus:   p.ToStatus,
		Summary:    p.Summary,
		Payload:    p.Payload,
		Visual:     visualJSON,
	}

	return s.db.InsertEventTx(ctx, tx, event)
}

// EventListResult is the paginated result for ListEvents.
type EventListResult struct {
	Events    []*model.Event `json:"events"`
	LatestSeq int64          `json:"latest_seq"`
	HasMore   bool           `json:"has_more"`
}

// ListEvents returns events after the given sequence number.
func (s *EventService) ListEvents(ctx context.Context, afterSeq int64, limit int) (*EventListResult, error) {
	events, latestSeq, hasMore, err := s.db.ListEventsAfterSeq(ctx, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	return &EventListResult{Events: events, LatestSeq: latestSeq, HasMore: hasMore}, nil
}

// LatestSeq returns the current highest sequence number.
func (s *EventService) LatestSeq(ctx context.Context) (int64, error) {
	return s.db.LatestSeq(ctx)
}
