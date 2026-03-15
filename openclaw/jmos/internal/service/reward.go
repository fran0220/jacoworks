package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type RewardService struct {
	db *store.DB
}

func NewRewardService(db *store.DB) *RewardService {
	return &RewardService{db: db}
}

// scoreRules maps review score (1-5) to point delta.
var scoreRules = map[int]int{
	5: +5,
	4: +5,
	3: 0,
	2: -5,
	1: -5,
}

// ApplyReviewScore calculates the reward delta from a review score and writes
// the reward log + agent score update within the given transaction.
// Returns nil (no-op) for score=3.
func (s *RewardService) ApplyReviewScore(ctx context.Context, tx store.DBTX, agentID, subTaskID string, score int) error {
	delta, ok := scoreRules[score]
	if !ok {
		return &store.ValidationError{Message: fmt.Sprintf("invalid review score: %d", score)}
	}
	if delta == 0 {
		return nil
	}

	reason := fmt.Sprintf("审查评分 %d 分", score)
	return s.AddReward(ctx, tx, agentID, reason, delta, subTaskID)
}

// AddReward writes a reward log entry and updates the agent's total_score, all within tx.
func (s *RewardService) AddReward(ctx context.Context, tx store.DBTX, agentID, reason string, delta int, subTaskID string) error {
	now := time.Now().UTC()
	log := &store.RewardLog{
		ID:         uuid.NewString(),
		AgentID:    agentID,
		SubTaskID:  subTaskID,
		Reason:     reason,
		ScoreDelta: delta,
		CreatedAt:  &now,
	}

	if err := s.db.InsertRewardLogTx(ctx, tx, log); err != nil {
		return err
	}
	return s.db.UpdateAgentScoreTx(ctx, tx, agentID, delta)
}

// GetAgentScore returns the score summary for an agent.
func (s *RewardService) GetAgentScore(ctx context.Context, agentID string) (*store.ScoreSummary, error) {
	return s.db.GetAgentScoreSummary(ctx, agentID)
}

// RewardLogListResult is the paginated response.
type RewardLogListResult struct {
	Items []*store.RewardLog `json:"items"`
	Total int                `json:"total"`
}

// ListRewardLogs returns paginated reward logs for an agent.
func (s *RewardService) ListRewardLogs(ctx context.Context, agentID string, page, pageSize int) (*RewardLogListResult, error) {
	items, total, err := s.db.ListRewardLogs(ctx, agentID, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &RewardLogListResult{Items: items, Total: total}, nil
}
