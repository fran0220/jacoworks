package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertPatrolRecord(ctx context.Context, p *model.PatrolRecord) error {
	subTaskID := nullableString(p.SubTaskID)
	agentID := nullableString(p.AgentID)
	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO patrol_record (id, type, severity, sub_task_id, agent_id, description, action_taken, status, created_at, resolved_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		p.ID, p.Type, p.Severity, subTaskID, agentID, p.Description,
		p.ActionTaken, p.Status, p.CreatedAt, p.ResolvedAt,
	)
	return err
}

func (db *DB) GetPatrolByID(ctx context.Context, id string) (*model.PatrolRecord, error) {
	p := &model.PatrolRecord{}
	var subTaskID, agentID sql.NullString
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, type, severity, sub_task_id, agent_id, description, action_taken, status, created_at, resolved_at
		 FROM patrol_record WHERE id = ?`, id,
	).Scan(&p.ID, &p.Type, &p.Severity, &subTaskID, &agentID, &p.Description,
		&p.ActionTaken, &p.Status, &p.CreatedAt, &p.ResolvedAt)
	p.SubTaskID = subTaskID.String
	p.AgentID = agentID.String
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "patrol_record", ID: id}
	}
	return p, err
}

func (db *DB) ListPatrolRecords(ctx context.Context, status string, page, pageSize int) ([]*model.PatrolRecord, int, error) {
	where := `WHERE 1=1`
	args := []any{}

	if status != "" {
		where += ` AND status = ?`
		args = append(args, status)
	}

	var total int
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM patrol_record `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := fmt.Sprintf(`SELECT id, type, severity, sub_task_id, agent_id, description, action_taken, status, created_at, resolved_at
		FROM patrol_record %s ORDER BY created_at DESC LIMIT ? OFFSET ?`, where)
	args = append(args, pageSize, offset)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*model.PatrolRecord
	for rows.Next() {
		p := &model.PatrolRecord{}
		var subTaskID, agentID sql.NullString
		if err := rows.Scan(&p.ID, &p.Type, &p.Severity, &subTaskID, &agentID, &p.Description,
			&p.ActionTaken, &p.Status, &p.CreatedAt, &p.ResolvedAt); err != nil {
			return nil, 0, err
		}
		p.SubTaskID = subTaskID.String
		p.AgentID = agentID.String
		items = append(items, p)
	}
	return items, total, rows.Err()
}

func (db *DB) ListActivePatrols(ctx context.Context) ([]*model.PatrolRecord, error) {
	rows, err := db.conn.QueryContext(ctx,
		`SELECT id, type, severity, sub_task_id, agent_id, description, action_taken, status, created_at, resolved_at
		 FROM patrol_record WHERE status = 'open' ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*model.PatrolRecord
	for rows.Next() {
		p := &model.PatrolRecord{}
		var subTaskID, agentID sql.NullString
		if err := rows.Scan(&p.ID, &p.Type, &p.Severity, &subTaskID, &agentID, &p.Description,
			&p.ActionTaken, &p.Status, &p.CreatedAt, &p.ResolvedAt); err != nil {
			return nil, err
		}
		p.SubTaskID = subTaskID.String
		p.AgentID = agentID.String
		items = append(items, p)
	}
	return items, rows.Err()
}

func (db *DB) UpdatePatrolStatus(ctx context.Context, id, status string, resolvedAt *time.Time) error {
	res, err := db.conn.ExecContext(ctx,
		`UPDATE patrol_record SET status = ?, resolved_at = ? WHERE id = ?`, status, resolvedAt, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "patrol_record", ID: id}
	}
	return nil
}
