package task

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultTaskType   = "chat"
	defaultMaxRetries = 2
	defaultTimeoutSec = 300
)

type Task struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	SessionID  string     `json:"session_id,omitempty"`
	WorkflowID string     `json:"workflow_id,omitempty"`
	Stage      string     `json:"stage"`
	Type       string     `json:"type"`
	Status     string     `json:"status"`
	Priority   int        `json:"priority"`
	AgentName  string     `json:"agent_name"`
	Prompt     string     `json:"prompt"`
	Result     *string    `json:"result,omitempty"`
	Error      *string    `json:"error,omitempty"`
	RetryCount int        `json:"retry_count"`
	MaxRetries int        `json:"max_retries"`
	TimeoutSec int        `json:"timeout_sec"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type Store struct {
	pool *pgxpool.Pool
}

type CreateTaskRequest struct {
	SessionID  string `json:"session_id,omitempty"`
	WorkflowID string `json:"workflow_id,omitempty"`
	Stage      string `json:"stage,omitempty"`
	Type       string `json:"type,omitempty"`
	Priority   int    `json:"priority,omitempty"`
	AgentName  string `json:"agent_name,omitempty"`
	Prompt     string `json:"prompt"`
	MaxRetries int    `json:"max_retries,omitempty"`
	TimeoutSec int    `json:"timeout_sec,omitempty"`
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Create(ctx context.Context, userID string, req CreateTaskRequest) (*Task, error) {
	req.Type = strings.TrimSpace(req.Type)
	if req.Type == "" {
		req.Type = defaultTaskType
	}
	req.AgentName = strings.TrimSpace(req.AgentName)
	req.Stage = strings.TrimSpace(req.Stage)
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		return nil, fmt.Errorf("create task: prompt is required")
	}
	if req.MaxRetries <= 0 {
		req.MaxRetries = defaultMaxRetries
	}
	if req.TimeoutSec <= 0 {
		req.TimeoutSec = defaultTimeoutSec
	}

	t := &Task{}
	var wfID, sessID *string
	if req.WorkflowID != "" {
		wfID = &req.WorkflowID
	}
	if req.SessionID != "" {
		sessID = &req.SessionID
	}
	row := s.pool.QueryRow(ctx,
		`INSERT INTO tasks (
			user_id, session_id, workflow_id, stage, type, status, priority, agent_name, prompt, max_retries, timeout_sec
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, user_id, COALESCE(session_id, ''), COALESCE(workflow_id, ''), stage, type, status, priority,
		          agent_name, prompt, result, error, retry_count, max_retries, timeout_sec,
		          started_at, finished_at, created_at, updated_at`,
		userID, sessID, wfID, req.Stage, req.Type, StatusPending, req.Priority, req.AgentName, req.Prompt, req.MaxRetries, req.TimeoutSec,
	)
	if err := scanTaskRow(t, row); err != nil {
		return nil, fmt.Errorf("create task: %w", err)
	}
	return t, nil
}

func (s *Store) Get(ctx context.Context, userID, taskID string) (*Task, error) {
	t := &Task{}
	row := s.pool.QueryRow(ctx,
		`SELECT id, user_id, COALESCE(session_id,''), COALESCE(workflow_id,''), stage, type, status, priority,
		        agent_name, prompt, result, error, retry_count, max_retries, timeout_sec,
		        started_at, finished_at, created_at, updated_at
		 FROM tasks WHERE id = $1 AND user_id = $2`,
		taskID, userID,
	)
	if err := scanTaskRow(t, row); err != nil {
		return nil, fmt.Errorf("get task: %w", err)
	}
	return t, nil
}

func (s *Store) ListByUser(ctx context.Context, userID string, statusFilter []string) ([]Task, error) {
	query := `SELECT id, user_id, COALESCE(session_id,''), COALESCE(workflow_id,''), stage, type, status, priority,
		        agent_name, prompt, result, error, retry_count, max_retries, timeout_sec,
		        started_at, finished_at, created_at, updated_at
		 FROM tasks WHERE user_id = $1`
	args := []any{userID}

	if len(statusFilter) > 0 {
		query += ` AND status = ANY($2)`
		args = append(args, statusFilter)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		if err := scanTaskRow(&t, rows); err != nil {
			return nil, fmt.Errorf("scan task: %w", err)
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list tasks rows: %w", err)
	}
	return tasks, nil
}

func (s *Store) ListPending(ctx context.Context, limit int) ([]Task, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, COALESCE(session_id,''), COALESCE(workflow_id,''), stage, type, status, priority,
		        agent_name, prompt, result, error, retry_count, max_retries, timeout_sec,
		        started_at, finished_at, created_at, updated_at
		 FROM tasks WHERE status = 'pending'
		 ORDER BY priority DESC, created_at ASC
		 LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list pending tasks: %w", err)
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		if err := scanTaskRow(&t, rows); err != nil {
			return nil, fmt.Errorf("scan pending task: %w", err)
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list pending tasks rows: %w", err)
	}
	return tasks, nil
}

func (s *Store) CountRunning(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND status = 'running'`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count running tasks: %w", err)
	}
	return count, nil
}

func (s *Store) UpdateStatus(ctx context.Context, taskID, newStatus string, fields map[string]any) error {
	if strings.TrimSpace(newStatus) == "" {
		return fmt.Errorf("update task status: new status is required")
	}
	newStatus = strings.TrimSpace(newStatus)

	var currentStatus string
	if err := s.pool.QueryRow(ctx, `SELECT status FROM tasks WHERE id = $1`, taskID).Scan(&currentStatus); err != nil {
		return fmt.Errorf("update task status: load current status: %w", err)
	}
	if currentStatus != newStatus {
		if err := ValidateTransition(currentStatus, newStatus); err != nil {
			return fmt.Errorf("update task status: %w", err)
		}
	}

	allowedColumns := map[string]string{
		"session_id":  "session_id",
		"workflow_id": "workflow_id",
		"stage":       "stage",
		"type":        "type",
		"priority":    "priority",
		"agent_name":  "agent_name",
		"prompt":      "prompt",
		"result":      "result",
		"error":       "error",
		"retry_count": "retry_count",
		"max_retries": "max_retries",
		"timeout_sec": "timeout_sec",
		"started_at":  "started_at",
		"finished_at": "finished_at",
	}

	setClauses := []string{"status = $1"}
	args := []any{newStatus}
	argPos := 2

	if len(fields) > 0 {
		keys := make([]string, 0, len(fields))
		for key := range fields {
			keys = append(keys, key)
		}
		sort.Strings(keys)

		for _, key := range keys {
			column, ok := allowedColumns[key]
			if !ok {
				return fmt.Errorf("update task status: unsupported field %q", key)
			}
			setClauses = append(setClauses, fmt.Sprintf("%s = $%d", column, argPos))
			args = append(args, fields[key])
			argPos++
		}
	}

	query := fmt.Sprintf("UPDATE tasks SET %s WHERE id = $%d", strings.Join(setClauses, ", "), argPos)
	args = append(args, taskID)

	tag, err := s.pool.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update task status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update task status: task not found")
	}
	return nil
}

func (s *Store) ListRunningTimedOut(ctx context.Context) ([]Task, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, COALESCE(session_id,''), COALESCE(workflow_id,''), stage, type, status, priority,
		        agent_name, prompt, result, error, retry_count, max_retries, timeout_sec,
		        started_at, finished_at, created_at, updated_at
		 FROM tasks
		 WHERE status = 'running' AND started_at IS NOT NULL
		   AND started_at + (timeout_sec * interval '1 second') < now()`,
	)
	if err != nil {
		return nil, fmt.Errorf("list timed out tasks: %w", err)
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		if err := scanTaskRow(&t, rows); err != nil {
			return nil, fmt.Errorf("scan timed out task: %w", err)
		}
		tasks = append(tasks, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list timed out tasks rows: %w", err)
	}
	return tasks, nil
}

func (s *Store) FindRunningBySession(ctx context.Context, userID, sessionID string) (*Task, error) {
	t := &Task{}
	row := s.pool.QueryRow(ctx,
		`SELECT id, user_id, COALESCE(session_id,''), COALESCE(workflow_id,''), stage, type, status, priority,
		        agent_name, prompt, result, error, retry_count, max_retries, timeout_sec,
		        started_at, finished_at, created_at, updated_at
		 FROM tasks WHERE user_id = $1 AND session_id = $2 AND status = 'running'
		 ORDER BY created_at DESC LIMIT 1`,
		userID, sessionID,
	)
	if err := scanTaskRow(t, row); err != nil {
		return nil, fmt.Errorf("find task by session: %w", err)
	}
	return t, nil
}

// Compatibility shim for existing callers. Keep until scheduler migration finishes.
func (s *Store) ListTimedOut(ctx context.Context) ([]Task, error) {
	return s.ListRunningTimedOut(ctx)
}

// Compatibility shim for existing callers. Keep until scheduler migration finishes.
func (s *Store) RetryTask(ctx context.Context, taskID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE tasks
		 SET status = 'pending',
		     retry_count = retry_count + 1,
		     started_at = NULL,
		     finished_at = NULL,
		     error = NULL
		 WHERE id = $1 AND retry_count < max_retries`,
		taskID,
	)
	if err != nil {
		return fmt.Errorf("retry task: %w", err)
	}
	return nil
}

// Compatibility shim for existing callers. Keep until scheduler migration finishes.
func (s *Store) FindBySession(ctx context.Context, userID, sessionID string) (*Task, error) {
	return s.FindRunningBySession(ctx, userID, sessionID)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTaskRow(t *Task, row scanner) error {
	return row.Scan(
		&t.ID, &t.UserID, &t.SessionID, &t.WorkflowID, &t.Stage, &t.Type, &t.Status, &t.Priority,
		&t.AgentName, &t.Prompt, &t.Result, &t.Error, &t.RetryCount, &t.MaxRetries, &t.TimeoutSec,
		&t.StartedAt, &t.FinishedAt, &t.CreatedAt, &t.UpdatedAt,
	)
}
