package store

import (
	"context"
	"fmt"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertRequestLog(ctx context.Context, l *model.RequestLog) error {
	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO request_log (id, timestamp, method, path, agent_id, agent_name, agent_role, request_body, response_status)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		l.ID, l.Timestamp, l.Method, l.Path, l.AgentID, l.AgentName, l.AgentRole,
		l.RequestBody, l.ResponseStatus,
	)
	return err
}

// ListRequestLogs returns request logs, optionally filtered by agent and time.
func (db *DB) ListRequestLogs(ctx context.Context, agentID string, afterTime string, limit int) ([]*model.RequestLog, error) {
	query := `SELECT id, timestamp, method, path, agent_id, agent_name, agent_role, request_body, response_status FROM request_log WHERE 1=1`
	args := []any{}

	if agentID != "" {
		query += ` AND agent_id = ?`
		args = append(args, agentID)
	}
	if afterTime != "" {
		query += ` AND timestamp >= ?`
		args = append(args, afterTime)
	}

	query += ` ORDER BY timestamp DESC`

	if limit <= 0 {
		limit = 100
	}
	query += fmt.Sprintf(` LIMIT %d`, limit)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*model.RequestLog
	for rows.Next() {
		l := &model.RequestLog{}
		if err := rows.Scan(&l.ID, &l.Timestamp, &l.Method, &l.Path, &l.AgentID, &l.AgentName, &l.AgentRole,
			&l.RequestBody, &l.ResponseStatus); err != nil {
			return nil, err
		}
		items = append(items, l)
	}
	return items, rows.Err()
}

// CleanupOldLogs deletes request logs older than retentionDays and returns the count deleted.
func (db *DB) CleanupOldLogs(ctx context.Context, retentionDays int) (int64, error) {
	res, err := db.conn.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM request_log WHERE timestamp < datetime('now', '-%d days')`, retentionDays),
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// CountTodayByAgent counts today's request logs grouped by agent ID.
func (db *DB) CountTodayByAgent(ctx context.Context, agentIDs []string) (map[string]int, error) {
	if len(agentIDs) == 0 {
		return map[string]int{}, nil
	}
	placeholders := makePlaceholders(len(agentIDs))
	args := make([]any, len(agentIDs))
	for i, id := range agentIDs {
		args[i] = id
	}

	query := fmt.Sprintf(`SELECT agent_id, COUNT(*) FROM request_log
		WHERE agent_id IN (%s) AND date(timestamp) = date('now')
		GROUP BY agent_id`, placeholders)

	return db.queryAgentCounts(ctx, query, args)
}

// CountTodaySubmitsByAgent counts today's submit actions from activity_log.
func (db *DB) CountTodaySubmitsByAgent(ctx context.Context, agentIDs []string) (map[string]int, error) {
	if len(agentIDs) == 0 {
		return map[string]int{}, nil
	}
	placeholders := makePlaceholders(len(agentIDs))
	args := make([]any, len(agentIDs))
	for i, id := range agentIDs {
		args[i] = id
	}

	query := fmt.Sprintf(`SELECT agent_id, COUNT(*) FROM activity_log
		WHERE agent_id IN (%s) AND action = 'submit' AND date(created_at) = date('now')
		GROUP BY agent_id`, placeholders)

	return db.queryAgentCounts(ctx, query, args)
}

// CountTodayReviewsByAgent counts today's review records grouped by reviewer agent.
func (db *DB) CountTodayReviewsByAgent(ctx context.Context, agentIDs []string) (map[string]int, error) {
	if len(agentIDs) == 0 {
		return map[string]int{}, nil
	}
	placeholders := makePlaceholders(len(agentIDs))
	args := make([]any, len(agentIDs))
	for i, id := range agentIDs {
		args[i] = id
	}

	query := fmt.Sprintf(`SELECT reviewer_agent, COUNT(*) FROM review_record
		WHERE reviewer_agent IN (%s) AND date(created_at) = date('now')
		GROUP BY reviewer_agent`, placeholders)

	return db.queryAgentCounts(ctx, query, args)
}

func (db *DB) queryAgentCounts(ctx context.Context, query string, args []any) (map[string]int, error) {
	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var id string
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			return nil, err
		}
		counts[id] = count
	}
	return counts, rows.Err()
}

func makePlaceholders(n int) string {
	if n <= 0 {
		return ""
	}
	s := "?"
	for i := 1; i < n; i++ {
		s += ",?"
	}
	return s
}
