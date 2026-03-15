package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

const subTaskColumns = `id, task_id, module_id, name, description, deliverable, acceptance, type, status, priority, assigned_agent, current_session_id, rework_count, estimated_minutes, actual_minutes, recurring_config, tags, deadline, created_at, updated_at, started_at, completed_at`

func scanSubTask(row interface{ Scan(dest ...any) error }) (*model.SubTask, error) {
	st := &model.SubTask{}
	var moduleID, assignedAgent sql.NullString
	err := row.Scan(
		&st.ID, &st.TaskID, &moduleID, &st.Name, &st.Description,
		&st.Deliverable, &st.Acceptance, &st.Type, &st.Status, &st.Priority,
		&assignedAgent, &st.CurrentSessionID, &st.ReworkCount,
		&st.EstimatedMinutes, &st.ActualMinutes, &st.RecurringConfig,
		&st.Tags, &st.Deadline, &st.CreatedAt, &st.UpdatedAt,
		&st.StartedAt, &st.CompletedAt,
	)
	st.ModuleID = moduleID.String
	st.AssignedAgent = assignedAgent.String
	return st, err
}

func (db *DB) InsertSubTask(ctx context.Context, st *model.SubTask) error {
	// nullable FK columns: empty string → NULL to avoid FK constraint failures
	moduleID := nullableString(st.ModuleID)
	assignedAgent := nullableString(st.AssignedAgent)

	_, err := db.conn.ExecContext(ctx,
		`INSERT INTO sub_task (`+subTaskColumns+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		st.ID, st.TaskID, moduleID, st.Name, st.Description,
		st.Deliverable, st.Acceptance, st.Type, st.Status, st.Priority,
		assignedAgent, st.CurrentSessionID, st.ReworkCount,
		st.EstimatedMinutes, st.ActualMinutes, st.RecurringConfig,
		st.Tags, st.Deadline, st.CreatedAt, st.UpdatedAt,
		st.StartedAt, st.CompletedAt,
	)
	return err
}

// nullableString returns nil (SQL NULL) for empty strings, preserving FK integrity.
func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (db *DB) GetSubTaskByID(ctx context.Context, id string) (*model.SubTask, error) {
	st, err := scanSubTask(db.conn.QueryRowContext(ctx,
		`SELECT `+subTaskColumns+` FROM sub_task WHERE id = ?`, id))
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "sub_task", ID: id}
	}
	return st, err
}

func (db *DB) ListSubTasks(ctx context.Context, taskID, moduleID, status, assignedAgent string, page, pageSize int, sortBy, sortOrder string) ([]*model.SubTask, int, error) {
	where := `WHERE 1=1`
	args := []any{}

	if taskID != "" {
		where += ` AND task_id = ?`
		args = append(args, taskID)
	}
	if moduleID != "" {
		where += ` AND module_id = ?`
		args = append(args, moduleID)
	}
	if status != "" {
		where += ` AND status = ?`
		args = append(args, status)
	}
	if assignedAgent != "" {
		where += ` AND assigned_agent = ?`
		args = append(args, assignedAgent)
	}

	var total int
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM sub_task `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	allowed := map[string]bool{"created_at": true, "updated_at": true, "priority": true, "name": true}
	if !allowed[sortBy] {
		sortBy = "created_at"
	}
	if strings.ToUpper(sortOrder) != "ASC" {
		sortOrder = "DESC"
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := fmt.Sprintf(`SELECT %s FROM sub_task %s ORDER BY %s %s LIMIT ? OFFSET ?`,
		subTaskColumns, where, sortBy, sortOrder)
	args = append(args, pageSize, offset)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*model.SubTask
	for rows.Next() {
		st, err := scanSubTask(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, st)
	}
	return items, total, rows.Err()
}

func (db *DB) ListMySubTasks(ctx context.Context, agentID, status string, page, pageSize int) ([]*model.SubTask, int, error) {
	where := `WHERE assigned_agent = ?`
	args := []any{agentID}

	if status != "" {
		where += ` AND status = ?`
		args = append(args, status)
	}

	var total int
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM sub_task `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := fmt.Sprintf(`SELECT %s FROM sub_task %s ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		subTaskColumns, where)
	args = append(args, pageSize, offset)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*model.SubTask
	for rows.Next() {
		st, err := scanSubTask(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, st)
	}
	return items, total, rows.Err()
}

func (db *DB) ListAvailableSubTasks(ctx context.Context, page, pageSize int) ([]*model.SubTask, int, error) {
	where := `WHERE status = 'pending' AND (assigned_agent IS NULL OR assigned_agent = '')`

	var total int
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM sub_task `+where).Scan(&total); err != nil {
		return nil, 0, err
	}

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	query := fmt.Sprintf(`SELECT %s FROM sub_task %s ORDER BY
		CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
		created_at ASC LIMIT ? OFFSET ?`, subTaskColumns, where)

	rows, err := db.conn.QueryContext(ctx, query, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*model.SubTask
	for rows.Next() {
		st, err := scanSubTask(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, st)
	}
	return items, total, rows.Err()
}

func (db *DB) GetLatestSubTask(ctx context.Context, taskID, agentID string) (*model.SubTask, error) {
	st, err := scanSubTask(db.conn.QueryRowContext(ctx,
		`SELECT `+subTaskColumns+` FROM sub_task WHERE task_id = ? AND assigned_agent = ? ORDER BY created_at DESC LIMIT 1`,
		taskID, agentID))
	if err == sql.ErrNoRows {
		return nil, &NotFoundError{Entity: "sub_task", ID: taskID + "/" + agentID}
	}
	return st, err
}

func (db *DB) UpdateSubTask(ctx context.Context, id string, fields map[string]any) error {
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

	query := fmt.Sprintf(`UPDATE sub_task SET %s, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		strings.Join(setClauses, ", "))

	res, err := db.conn.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "sub_task", ID: id}
	}
	return nil
}

// UpdateSubTaskStatus updates status and optional extra fields. Accepts DBTX for transaction support.
func (db *DB) UpdateSubTaskStatus(ctx context.Context, id, status string, extras map[string]any) error {
	return db.UpdateSubTaskStatusTx(ctx, db.conn, id, status, extras)
}

// UpdateSubTaskStatusTx is the transaction-aware variant.
func (db *DB) UpdateSubTaskStatusTx(ctx context.Context, tx DBTX, id, status string, extras map[string]any) error {
	setClauses := []string{"status = ?", "updated_at = CURRENT_TIMESTAMP"}
	args := []any{status}

	for k, v := range extras {
		setClauses = append(setClauses, k+" = ?")
		args = append(args, v)
	}
	args = append(args, id)

	query := fmt.Sprintf(`UPDATE sub_task SET %s WHERE id = ?`, strings.Join(setClauses, ", "))
	res, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return &NotFoundError{Entity: "sub_task", ID: id}
	}
	return nil
}
