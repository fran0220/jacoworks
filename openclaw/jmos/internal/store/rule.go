package store

import (
	"context"
	"database/sql"
	"strings"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertRule(ctx context.Context, r *model.Rule) error {
	taskID := nullableString(r.TaskID)
	subTaskID := nullableString(r.SubTaskID)
	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO rule (id, scope, project, task_id, sub_task_id, content, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?)`,
		r.ID, r.Scope, r.Project, taskID, subTaskID, r.Content, r.CreatedAt, r.UpdatedAt,
	)
	return err
}

func (db *DB) GetRuleByID(ctx context.Context, id string) (*model.Rule, error) {
	r := &model.Rule{}
	var taskID, subTaskID sql.NullString
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, scope, project, task_id, sub_task_id, content, created_at, updated_at
		 FROM rule WHERE id = ?`, id,
	).Scan(&r.ID, &r.Scope, &r.Project, &taskID, &subTaskID, &r.Content, &r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "rule", ID: id}
	}
	r.TaskID = taskID.String
	r.SubTaskID = subTaskID.String
	return r, err
}

func (db *DB) ListRules(ctx context.Context, scope, project, taskID string) ([]*model.Rule, error) {
	query := `SELECT id, scope, project, task_id, sub_task_id, content, created_at, updated_at FROM rule WHERE 1=1`
	args := []any{}

	if scope != "" {
		query += ` AND scope = ?`
		args = append(args, scope)
	}
	if project != "" {
		query += ` AND project = ?`
		args = append(args, project)
	}
	if taskID != "" {
		query += ` AND task_id = ?`
		args = append(args, taskID)
	}
	query += ` ORDER BY created_at`

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*model.Rule
	for rows.Next() {
		r := &model.Rule{}
		var rTaskID, rSubTaskID sql.NullString
		if err := rows.Scan(&r.ID, &r.Scope, &r.Project, &rTaskID, &rSubTaskID, &r.Content, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		r.TaskID = rTaskID.String
		r.SubTaskID = rSubTaskID.String
		rules = append(rules, r)
	}
	return rules, rows.Err()
}

func (db *DB) UpdateRule(ctx context.Context, id, content string) error {
	res, err := db.conn.ExecContext(ctx,
		`UPDATE rule SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, content, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "rule", ID: id}
	}
	return nil
}

func (db *DB) DeleteRule(ctx context.Context, id string) error {
	res, err := db.conn.ExecContext(ctx,
		`DELETE FROM rule WHERE id = ?`, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "rule", ID: id}
	}
	return nil
}

// GetMergedRules returns rules merged in order: global → project → task → sub_task,
// joined with "\n\n---\n\n".
func (db *DB) GetMergedRules(ctx context.Context, project, taskID, subTaskID string) (string, error) {
	var parts []string

	// 1. Global rules
	globals, err := db.conn.QueryContext(ctx,
		`SELECT content FROM rule WHERE scope = 'global' ORDER BY created_at`)
	if err != nil {
		return "", err
	}
	defer globals.Close()
	for globals.Next() {
		var c string
		if err := globals.Scan(&c); err != nil {
			return "", err
		}
		parts = append(parts, c)
	}
	if err := globals.Err(); err != nil {
		return "", err
	}

	// 2. Project rules
	if project != "" {
		projRows, err := db.conn.QueryContext(ctx,
			`SELECT content FROM rule WHERE scope = 'project' AND project = ? ORDER BY created_at`, project)
		if err != nil {
			return "", err
		}
		defer projRows.Close()
		for projRows.Next() {
			var c string
			if err := projRows.Scan(&c); err != nil {
				return "", err
			}
			parts = append(parts, c)
		}
		if err := projRows.Err(); err != nil {
			return "", err
		}
	}

	// 3. Task rules
	if taskID != "" {
		taskRows, err := db.conn.QueryContext(ctx,
			`SELECT content FROM rule WHERE scope = 'task' AND task_id = ? ORDER BY created_at`, taskID)
		if err != nil {
			return "", err
		}
		defer taskRows.Close()
		for taskRows.Next() {
			var c string
			if err := taskRows.Scan(&c); err != nil {
				return "", err
			}
			parts = append(parts, c)
		}
		if err := taskRows.Err(); err != nil {
			return "", err
		}
	}

	// 4. Sub-task rules
	if subTaskID != "" {
		stRows, err := db.conn.QueryContext(ctx,
			`SELECT content FROM rule WHERE scope = 'sub_task' AND sub_task_id = ? ORDER BY created_at`, subTaskID)
		if err != nil {
			return "", err
		}
		defer stRows.Close()
		for stRows.Next() {
			var c string
			if err := stRows.Scan(&c); err != nil {
				return "", err
			}
			parts = append(parts, c)
		}
		if err := stRows.Err(); err != nil {
			return "", err
		}
	}

	return strings.Join(parts, "\n\n---\n\n"), nil
}
