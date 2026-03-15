package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertReview(ctx context.Context, r *model.ReviewRecord) error {
	return db.InsertReviewTx(ctx, db.conn, r)
}

// InsertReviewTx inserts a review record within a given transaction.
func (db *DB) InsertReviewTx(ctx context.Context, tx DBTX, r *model.ReviewRecord) error {
	reworkAgent := nullableString(r.ReworkAgent)
	_, err := tx.ExecContext(ctx,
		`INSERT INTO review_record (id, sub_task_id, reviewer_agent, round, result, score, issues, comment, rework_agent, created_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.SubTaskID, r.ReviewerAgent, r.Round, r.Result, r.Score,
		r.Issues, r.Comment, reworkAgent, r.CreatedAt,
	)
	return err
}

func (db *DB) GetReviewByID(ctx context.Context, id string) (*model.ReviewRecord, error) {
	r := &model.ReviewRecord{}
	var reworkAgent sql.NullString
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, sub_task_id, reviewer_agent, round, result, score, issues, comment, rework_agent, created_at
		 FROM review_record WHERE id = ?`, id,
	).Scan(&r.ID, &r.SubTaskID, &r.ReviewerAgent, &r.Round, &r.Result, &r.Score,
		&r.Issues, &r.Comment, &reworkAgent, &r.CreatedAt)
	r.ReworkAgent = reworkAgent.String
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "review_record", ID: id}
	}
	return r, err
}

func (db *DB) ListReviews(ctx context.Context, subTaskID string, page, pageSize int) ([]*model.ReviewRecord, int, error) {
	where := `WHERE 1=1`
	args := []any{}

	if subTaskID != "" {
		where += ` AND sub_task_id = ?`
		args = append(args, subTaskID)
	}

	var total int
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM review_record `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := fmt.Sprintf(`SELECT id, sub_task_id, reviewer_agent, round, result, score, issues, comment, rework_agent, created_at
		FROM review_record %s ORDER BY created_at DESC LIMIT ? OFFSET ?`, where)
	args = append(args, pageSize, offset)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*model.ReviewRecord
	for rows.Next() {
		r := &model.ReviewRecord{}
		var reworkAgent sql.NullString
		if err := rows.Scan(&r.ID, &r.SubTaskID, &r.ReviewerAgent, &r.Round, &r.Result, &r.Score,
			&r.Issues, &r.Comment, &reworkAgent, &r.CreatedAt); err != nil {
			return nil, 0, err
		}
		r.ReworkAgent = reworkAgent.String
		items = append(items, r)
	}
	return items, total, rows.Err()
}

func (db *DB) CountReviewsBySubTask(ctx context.Context, subTaskID string) (int, error) {
	var count int
	err := db.conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM review_record WHERE sub_task_id = ?`, subTaskID,
	).Scan(&count)
	return count, err
}
