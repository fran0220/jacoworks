package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// RewardLog represents a single score change entry.
type RewardLog struct {
	ID         string     `json:"id"`
	AgentID    string     `json:"agent_id"`
	SubTaskID  string     `json:"sub_task_id"`
	Reason     string     `json:"reason"`
	ScoreDelta int        `json:"score_delta"`
	CreatedAt  *time.Time `json:"created_at"`
}

// ScoreSummary aggregates reward data for an agent.
type ScoreSummary struct {
	AgentID      string `json:"agent_id"`
	AgentName    string `json:"agent_name"`
	TotalScore   int    `json:"total_score"`
	Rank         int    `json:"rank"`
	TotalAgents  int    `json:"total_agents"`
	RewardCount  int    `json:"reward_count"`
	PenaltyCount int    `json:"penalty_count"`
	TotalRecords int    `json:"total_records"`
}

func (db *DB) InsertRewardLog(ctx context.Context, r *RewardLog) error {
	return db.InsertRewardLogTx(ctx, db.conn, r)
}

// InsertRewardLogTx inserts a reward log within a given transaction.
func (db *DB) InsertRewardLogTx(ctx context.Context, tx DBTX, r *RewardLog) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO reward_log (id, agent_id, sub_task_id, reason, score_delta, created_at)
		 VALUES (?,?,?,?,?,?)`,
		r.ID, r.AgentID, r.SubTaskID, r.Reason, r.ScoreDelta, r.CreatedAt,
	)
	return err
}

// UpdateAgentScoreTx atomically increments an agent's total_score within a transaction.
func (db *DB) UpdateAgentScoreTx(ctx context.Context, tx DBTX, id string, delta int) error {
	res, err := tx.ExecContext(ctx,
		`UPDATE agent SET total_score = total_score + ? WHERE id = ?`, delta, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "agent", ID: id}
	}
	return nil
}

func (db *DB) ListRewardLogs(ctx context.Context, agentID string, page, pageSize int) ([]*RewardLog, int, error) {
	where := `WHERE agent_id = ?`
	args := []any{agentID}

	var total int
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM reward_log `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := fmt.Sprintf(`SELECT id, agent_id, sub_task_id, reason, score_delta, created_at
		FROM reward_log %s ORDER BY created_at DESC LIMIT ? OFFSET ?`, where)
	args = append(args, pageSize, offset)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*RewardLog
	for rows.Next() {
		r := &RewardLog{}
		if err := rows.Scan(&r.ID, &r.AgentID, &r.SubTaskID, &r.Reason, &r.ScoreDelta, &r.CreatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, r)
	}
	return items, total, rows.Err()
}

func (db *DB) GetAgentScoreSummary(ctx context.Context, agentID string) (*ScoreSummary, error) {
	// Get agent info
	var name string
	var totalScore int
	err := db.conn.QueryRowContext(ctx,
		`SELECT name, total_score FROM agent WHERE id = ?`, agentID,
	).Scan(&name, &totalScore)
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "agent", ID: agentID}
	}
	if err != nil {
		return nil, err
	}

	// Count rewards / penalties
	var rewardCount, penaltyCount, totalRecords int
	err = db.conn.QueryRowContext(ctx,
		`SELECT
			COUNT(*),
			COALESCE(SUM(CASE WHEN score_delta > 0 THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN score_delta < 0 THEN 1 ELSE 0 END), 0)
		 FROM reward_log WHERE agent_id = ?`, agentID,
	).Scan(&totalRecords, &rewardCount, &penaltyCount)
	if err != nil {
		return nil, err
	}

	// Rank
	var higherCount int
	if err := db.conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM agent WHERE total_score > ?`, totalScore,
	).Scan(&higherCount); err != nil {
		return nil, err
	}

	var totalAgents int
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent`).Scan(&totalAgents); err != nil {
		return nil, err
	}

	return &ScoreSummary{
		AgentID:      agentID,
		AgentName:    name,
		TotalScore:   totalScore,
		Rank:         higherCount + 1,
		TotalAgents:  totalAgents,
		RewardCount:  rewardCount,
		PenaltyCount: penaltyCount,
		TotalRecords: totalRecords,
	}, nil
}
