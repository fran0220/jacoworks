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

type ReviewService struct {
	db      *store.DB
	subTask *SubTaskService
	reward  *RewardService
	event   *EventService
}

func NewReviewService(db *store.DB, subTask *SubTaskService, reward *RewardService, event *EventService) *ReviewService {
	return &ReviewService{db: db, subTask: subTask, reward: reward, event: event}
}

// CreateReviewParams holds the input for creating a review.
type CreateReviewParams struct {
	SubTaskID     string
	ReviewerAgent string
	Result        string // approved or rejected
	Score         int    // 1-5
	Issues        string
	Comment       string
	ReworkAgent   string
}

// CreateReview writes a review record, advances the sub-task state, applies reward scoring,
// and publishes an event — all within a single transaction.
func (s *ReviewService) CreateReview(ctx context.Context, p CreateReviewParams) (*model.ReviewRecord, error) {
	if p.Result != "approved" && p.Result != "rejected" {
		return nil, &store.ValidationError{Message: fmt.Sprintf("invalid result %q, must be approved or rejected", p.Result)}
	}
	if p.Score < 1 || p.Score > 5 {
		return nil, &store.ValidationError{Message: fmt.Sprintf("score must be 1-5, got %d", p.Score)}
	}
	if p.Result == "rejected" && p.Issues == "" {
		return nil, &store.ValidationError{Message: "issues required when rejecting"}
	}

	// Validate sub-task exists and is in review status
	st, err := s.db.GetSubTaskByID(ctx, p.SubTaskID)
	if err != nil {
		return nil, err
	}
	if st.Status != "review" {
		return nil, &store.ValidationError{Message: fmt.Sprintf("sub-task status is %s, must be review", st.Status)}
	}

	// Validate reviewer agent
	reviewer, err := s.db.GetAgentByID(ctx, p.ReviewerAgent)
	if err != nil {
		return nil, err
	}

	// Validate rework agent if specified
	if p.ReworkAgent != "" {
		if _, err := s.db.GetAgentByID(ctx, p.ReworkAgent); err != nil {
			return nil, err
		}
	}

	executorAgentID := st.AssignedAgent

	// Calculate review round
	roundCount, err := s.db.CountReviewsBySubTask(ctx, p.SubTaskID)
	if err != nil {
		return nil, err
	}
	round := roundCount + 1

	now := time.Now().UTC()
	record := &model.ReviewRecord{
		ID:            uuid.NewString(),
		SubTaskID:     p.SubTaskID,
		ReviewerAgent: p.ReviewerAgent,
		Round:         round,
		Result:        p.Result,
		Score:         p.Score,
		Issues:        p.Issues,
		Comment:       p.Comment,
		ReworkAgent:   p.ReworkAgent,
		CreatedAt:     &now,
	}

	err = s.db.WithTx(ctx, func(tx *sql.Tx) error {
		// 1. Write review record
		if err := s.db.InsertReviewTx(ctx, tx, record); err != nil {
			return err
		}

		// 2. Advance sub-task status
		if p.Result == "approved" {
			if _, err := s.subTask.CompleteSubTaskTx(ctx, tx, p.SubTaskID); err != nil {
				return err
			}
		} else {
			if _, err := s.subTask.ReworkSubTaskTx(ctx, tx, p.SubTaskID, p.ReworkAgent); err != nil {
				return err
			}
		}

		// 3. Apply reward scoring
		if executorAgentID != "" {
			if err := s.reward.ApplyReviewScore(ctx, tx, executorAgentID, p.SubTaskID, p.Score); err != nil {
				return err
			}
		}

		// 4. Publish event
		action := "approve"
		toStatus := "done"
		if p.Result == "rejected" {
			action = "reject"
			toStatus = "rework"
		}

		if _, err := s.event.Publish(ctx, tx, PublishParams{
			Type:       "review",
			ActorID:    reviewer.ID,
			ActorName:  reviewer.Name,
			ActorRole:  reviewer.Role,
			TaskID:     st.TaskID,
			SubTaskID:  p.SubTaskID,
			TargetType: "sub_task",
			TargetID:   p.SubTaskID,
			TargetName: st.Name,
			Action:     action,
			FromStatus: "review",
			ToStatus:   toStatus,
			Summary:    fmt.Sprintf("%s %s sub-task %q (score: %d)", reviewer.Name, p.Result, st.Name, p.Score),
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

// ReviewListResult is the paginated response.
type ReviewListResult struct {
	Items []*model.ReviewRecord `json:"items"`
	Total int                   `json:"total"`
}

// ListReviews returns paginated reviews, optionally filtered by sub-task.
func (s *ReviewService) ListReviews(ctx context.Context, subTaskID string, page, pageSize int) (*ReviewListResult, error) {
	items, total, err := s.db.ListReviews(ctx, subTaskID, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &ReviewListResult{Items: items, Total: total}, nil
}

// GetReview returns a single review record.
func (s *ReviewService) GetReview(ctx context.Context, id string) (*model.ReviewRecord, error) {
	return s.db.GetReviewByID(ctx, id)
}
