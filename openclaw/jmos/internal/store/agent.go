package store

import (
	"context"
	"database/sql"
	"time"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertAgent(ctx context.Context, a *model.Agent) error {
	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO agent (id, name, role, description, status, api_key, total_score, capabilities, avatar_seed, current_action, current_sub_task_id, current_session_id, last_seen_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.Name, a.Role, a.Description, a.Status, a.APIKey, a.TotalScore,
		a.Capabilities, a.AvatarSeed, a.CurrentAction,
		a.CurrentSubTaskID, a.CurrentSessionID, a.LastSeenAt, a.CreatedAt,
	)
	return err
}

func (db *DB) GetAgentByID(ctx context.Context, id string) (*model.Agent, error) {
	a := &model.Agent{}
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, name, role, description, status, api_key, total_score, capabilities, avatar_seed, current_action, current_sub_task_id, current_session_id, last_seen_at, created_at
		 FROM agent WHERE id = ?`, id,
	).Scan(
		&a.ID, &a.Name, &a.Role, &a.Description, &a.Status, &a.APIKey, &a.TotalScore,
		&a.Capabilities, &a.AvatarSeed, &a.CurrentAction,
		&a.CurrentSubTaskID, &a.CurrentSessionID, &a.LastSeenAt, &a.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "agent", ID: id}
	}
	return a, err
}

func (db *DB) GetAgentByAPIKey(ctx context.Context, apiKey string) (*model.Agent, error) {
	a := &model.Agent{}
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, name, role, description, status, api_key, total_score, capabilities, avatar_seed, current_action, current_sub_task_id, current_session_id, last_seen_at, created_at
		 FROM agent WHERE api_key = ?`, apiKey,
	).Scan(
		&a.ID, &a.Name, &a.Role, &a.Description, &a.Status, &a.APIKey, &a.TotalScore,
		&a.Capabilities, &a.AvatarSeed, &a.CurrentAction,
		&a.CurrentSubTaskID, &a.CurrentSessionID, &a.LastSeenAt, &a.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "agent", ID: apiKey}
	}
	return a, err
}

func (db *DB) ListAgents(ctx context.Context, role, status string) ([]*model.Agent, error) {
	query := `SELECT id, name, role, description, status, api_key, total_score, capabilities, avatar_seed, current_action, current_sub_task_id, current_session_id, last_seen_at, created_at FROM agent WHERE 1=1`
	args := []any{}

	if role != "" {
		query += ` AND role = ?`
		args = append(args, role)
	}
	if status != "" {
		query += ` AND status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var agents []*model.Agent
	for rows.Next() {
		a := &model.Agent{}
		if err := rows.Scan(
			&a.ID, &a.Name, &a.Role, &a.Description, &a.Status, &a.APIKey, &a.TotalScore,
			&a.Capabilities, &a.AvatarSeed, &a.CurrentAction,
			&a.CurrentSubTaskID, &a.CurrentSessionID, &a.LastSeenAt, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, rows.Err()
}

func (db *DB) UpdateAgentStatus(ctx context.Context, id, status string) error {
	res, err := db.conn.ExecContext(ctx,
		`UPDATE agent SET status = ? WHERE id = ?`, status, id,
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

func (db *DB) UpdateAgentPulse(ctx context.Context, id, status, currentAction, subTaskID, sessionID string) error {
	now := time.Now().UTC()
	res, err := db.conn.ExecContext(ctx,
		`UPDATE agent SET status = ?, current_action = ?, current_sub_task_id = ?, current_session_id = ?, last_seen_at = ? WHERE id = ?`,
		status, currentAction, subTaskID, sessionID, now, id,
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

func (db *DB) UpdateAgentScore(ctx context.Context, id string, delta int) error {
	res, err := db.conn.ExecContext(ctx,
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

func (db *DB) ResetAgentAPIKey(ctx context.Context, id, newKey string) error {
	res, err := db.conn.ExecContext(ctx,
		`UPDATE agent SET api_key = ? WHERE id = ?`, newKey, id,
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

// GetAgentByName returns an agent by name, or nil if not found.
func (db *DB) GetAgentByName(ctx context.Context, name string) (*model.Agent, error) {
	a := &model.Agent{}
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, name, role, description, status, api_key, total_score, capabilities, avatar_seed, current_action, current_sub_task_id, current_session_id, last_seen_at, created_at
		 FROM agent WHERE name = ?`, name,
	).Scan(
		&a.ID, &a.Name, &a.Role, &a.Description, &a.Status, &a.APIKey, &a.TotalScore,
		&a.Capabilities, &a.AvatarSeed, &a.CurrentAction,
		&a.CurrentSubTaskID, &a.CurrentSessionID, &a.LastSeenAt, &a.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return a, err
}
