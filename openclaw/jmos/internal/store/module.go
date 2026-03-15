package store

import (
	"context"
	"database/sql"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertModule(ctx context.Context, m *model.Module) error {
	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO module (id, task_id, name, description, sort_order, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		m.ID, m.TaskID, m.Name, m.Description, m.SortOrder, m.CreatedAt,
	)
	return err
}

func (db *DB) GetModuleByID(ctx context.Context, id string) (*model.Module, error) {
	m := &model.Module{}
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, task_id, name, description, sort_order, created_at
		 FROM module WHERE id = ?`, id,
	).Scan(&m.ID, &m.TaskID, &m.Name, &m.Description, &m.SortOrder, &m.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "module", ID: id}
	}
	return m, err
}

func (db *DB) ListModules(ctx context.Context, taskID string) ([]*model.Module, error) {
	rows, err := db.conn.QueryContext(ctx,
		`SELECT id, task_id, name, description, sort_order, created_at
		 FROM module WHERE task_id = ? ORDER BY sort_order, created_at`, taskID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var modules []*model.Module
	for rows.Next() {
		m := &model.Module{}
		if err := rows.Scan(&m.ID, &m.TaskID, &m.Name, &m.Description, &m.SortOrder, &m.CreatedAt); err != nil {
			return nil, err
		}
		modules = append(modules, m)
	}
	return modules, rows.Err()
}
