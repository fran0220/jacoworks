package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

func (db *DB) InsertTask(ctx context.Context, t *model.Task) error {
	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO task (id, project, name, description, type, status, created_by, deadline, tags, metadata, created_at, updated_at, completed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.Project, t.Name, t.Description, t.Type, t.Status, t.CreatedBy,
		t.Deadline, t.Tags, t.Metadata, t.CreatedAt, t.UpdatedAt, t.CompletedAt,
	)
	return err
}

func (db *DB) GetTaskByID(ctx context.Context, id string) (*model.Task, error) {
	t := &model.Task{}
	err := db.conn.QueryRowContext(ctx,
		`SELECT id, project, name, description, type, status, created_by, deadline, tags, metadata, created_at, updated_at, completed_at
		 FROM task WHERE id = ?`, id,
	).Scan(
		&t.ID, &t.Project, &t.Name, &t.Description, &t.Type, &t.Status, &t.CreatedBy,
		&t.Deadline, &t.Tags, &t.Metadata, &t.CreatedAt, &t.UpdatedAt, &t.CompletedAt,
	)
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "task", ID: id}
	}
	return t, err
}

// ListTasks returns paginated tasks with optional filters.
// sortBy: "created_at" (default), "updated_at", "name"
// sortOrder: "asc" or "desc" (default)
func (db *DB) ListTasks(ctx context.Context, project, status, keyword string, page, pageSize int, sortBy, sortOrder string) ([]*model.Task, int, error) {
	where := `WHERE 1=1`
	args := []any{}

	if project != "" {
		where += ` AND project = ?`
		args = append(args, project)
	}
	if status != "" {
		where += ` AND status = ?`
		args = append(args, status)
	}
	if keyword != "" {
		where += ` AND (name LIKE ? OR description LIKE ?)`
		kw := "%" + keyword + "%"
		args = append(args, kw, kw)
	}

	// Count total
	var total int
	countQuery := `SELECT COUNT(*) FROM task ` + where
	if err := db.conn.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Validate sort
	allowedSort := map[string]bool{"created_at": true, "updated_at": true, "name": true}
	if !allowedSort[sortBy] {
		sortBy = "created_at"
	}
	if strings.ToUpper(sortOrder) != "ASC" {
		sortOrder = "DESC"
	}

	query := fmt.Sprintf(`SELECT id, project, name, description, type, status, created_by, deadline, tags, metadata, created_at, updated_at, completed_at FROM task %s ORDER BY %s %s LIMIT ? OFFSET ?`,
		where, sortBy, sortOrder)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize
	args = append(args, pageSize, offset)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var tasks []*model.Task
	for rows.Next() {
		t := &model.Task{}
		if err := rows.Scan(
			&t.ID, &t.Project, &t.Name, &t.Description, &t.Type, &t.Status, &t.CreatedBy,
			&t.Deadline, &t.Tags, &t.Metadata, &t.CreatedAt, &t.UpdatedAt, &t.CompletedAt,
		); err != nil {
			return nil, 0, err
		}
		tasks = append(tasks, t)
	}
	return tasks, total, rows.Err()
}

func (db *DB) UpdateTask(ctx context.Context, id string, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}

	setClauses := make([]string, 0, len(fields))
	args := make([]any, 0, len(fields)+1)
	for k, v := range fields {
		setClauses = append(setClauses, k+" = ?")
		args = append(args, v)
	}
	args = append(args, id)

	query := fmt.Sprintf(`UPDATE task SET %s, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		strings.Join(setClauses, ", "))

	res, err := db.conn.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "task", ID: id}
	}
	return nil
}

func (db *DB) UpdateTaskStatus(ctx context.Context, id, status string) error {
	res, err := db.conn.ExecContext(ctx,
		`UPDATE task SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, status, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "task", ID: id}
	}
	return nil
}

// SubTaskCountsByTask returns a map of status → count for all sub_tasks of a given task.
func (db *DB) SubTaskCountsByTask(ctx context.Context, taskID string) (map[string]int, error) {
	rows, err := db.conn.QueryContext(ctx,
		`SELECT status, COUNT(*) FROM sub_task WHERE task_id = ? GROUP BY status`, taskID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		counts[status] = count
	}
	return counts, rows.Err()
}
