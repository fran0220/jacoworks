package store

import (
	"context"
	"fmt"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertActivityLog(ctx context.Context, l *model.ActivityLog) error {
	subTaskID := nullableString(l.SubTaskID)
	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO activity_log (id, agent_id, sub_task_id, action, summary, session_id, created_at)
		 VALUES (?,?,?,?,?,?,?)`,
		l.ID, l.AgentID, subTaskID, l.Action, l.Summary, l.SessionID, l.CreatedAt,
	)
	return err
}

// ListActivityLogs returns activity logs with optional filters.
// days limits to last N days (0 = no limit). limit caps the result count (0 = default 100).
func (db *DB) ListActivityLogs(ctx context.Context, agentID, subTaskID, action string, days, limit int) ([]*model.ActivityLog, error) {
	query := `SELECT id, agent_id, sub_task_id, action, summary, session_id, created_at FROM activity_log WHERE 1=1`
	args := []any{}

	if agentID != "" {
		query += ` AND agent_id = ?`
		args = append(args, agentID)
	}
	if subTaskID != "" {
		query += ` AND sub_task_id = ?`
		args = append(args, subTaskID)
	}
	if action != "" {
		query += ` AND action = ?`
		args = append(args, action)
	}
	if days > 0 {
		query += fmt.Sprintf(` AND created_at >= datetime('now', '-%d days')`, days)
	}

	query += ` ORDER BY created_at DESC`

	if limit <= 0 {
		limit = 100
	}
	query += fmt.Sprintf(` LIMIT %d`, limit)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*model.ActivityLog
	for rows.Next() {
		l := &model.ActivityLog{}
		if err := rows.Scan(&l.ID, &l.AgentID, &l.SubTaskID, &l.Action, &l.Summary, &l.SessionID, &l.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, l)
	}
	return items, rows.Err()
}

// ListMyActivityLogs returns activity logs for a specific agent.
func (db *DB) ListMyActivityLogs(ctx context.Context, agentID, action string, days, limit int) ([]*model.ActivityLog, error) {
	return db.ListActivityLogs(ctx, agentID, "", action, days, limit)
}
