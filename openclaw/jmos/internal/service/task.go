package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type TaskService struct {
	db *store.DB
}

func NewTaskService(db *store.DB) *TaskService {
	return &TaskService{db: db}
}

var validTaskStatuses = map[string]bool{
	"planning": true, "active": true, "in_progress": true,
	"completed": true, "archived": true, "cancelled": true,
}

var validTaskTypes = map[string]bool{
	"once": true, "recurring": true,
}

// TaskWithCounts extends Task with sub-task status counts.
type TaskWithCounts struct {
	*model.Task
	SubTaskCounts map[string]int `json:"sub_task_counts"`
}

// TaskListResult is the paginated result for ListTasks.
type TaskListResult struct {
	Items []*model.Task `json:"items"`
	Total int           `json:"total"`
}

// CreateTask creates a new task.
func (s *TaskService) CreateTask(ctx context.Context, project, name, description, taskType, createdBy string) (*model.Task, error) {
	if taskType == "" {
		taskType = "once"
	}
	if !validTaskTypes[taskType] {
		return nil, &store.ValidationError{Message: "invalid task type: " + taskType}
	}
	if project == "" {
		project = "default"
	}

	now := time.Now().UTC()
	task := &model.Task{
		ID:          uuid.NewString(),
		Project:     project,
		Name:        name,
		Description: description,
		Type:        taskType,
		Status:      "planning",
		CreatedBy:   createdBy,
		Tags:        "[]",
		Metadata:    "{}",
		CreatedAt:   &now,
		UpdatedAt:   &now,
	}
	if err := s.db.InsertTask(ctx, task); err != nil {
		return nil, err
	}
	return task, nil
}

// ListTasks returns paginated tasks with filters.
func (s *TaskService) ListTasks(ctx context.Context, project, status, keyword string, page, pageSize int, sortBy, sortOrder string) (*TaskListResult, error) {
	items, total, err := s.db.ListTasks(ctx, project, status, keyword, page, pageSize, sortBy, sortOrder)
	if err != nil {
		return nil, err
	}
	return &TaskListResult{Items: items, Total: total}, nil
}

// GetTask returns a task with sub-task status counts.
func (s *TaskService) GetTask(ctx context.Context, id string) (*TaskWithCounts, error) {
	task, err := s.db.GetTaskByID(ctx, id)
	if err != nil {
		return nil, err
	}

	counts, err := s.db.SubTaskCountsByTask(ctx, id)
	if err != nil {
		return nil, err
	}

	return &TaskWithCounts{Task: task, SubTaskCounts: counts}, nil
}

// UpdateTask edits task name/description. Only allowed in planning/active status.
func (s *TaskService) UpdateTask(ctx context.Context, id, name, description string) error {
	task, err := s.db.GetTaskByID(ctx, id)
	if err != nil {
		return err
	}
	if task.Status != "planning" && task.Status != "active" {
		return &store.ValidationError{Message: "task can only be edited in planning/active status, current: " + task.Status}
	}

	fields := map[string]any{}
	if name != "" {
		fields["name"] = name
	}
	if description != "" {
		fields["description"] = description
	}
	if len(fields) == 0 {
		return nil
	}
	return s.db.UpdateTask(ctx, id, fields)
}

// UpdateTaskStatus validates the status transition and updates the task.
func (s *TaskService) UpdateTaskStatus(ctx context.Context, id, status string) error {
	if !validTaskStatuses[status] {
		return &store.ValidationError{Message: "invalid task status: " + status}
	}

	task, err := s.db.GetTaskByID(ctx, id)
	if err != nil {
		return err
	}
	if task.Status == "completed" || task.Status == "cancelled" {
		return &store.ValidationError{Message: "cannot change status of " + task.Status + " task"}
	}

	return s.db.UpdateTaskStatus(ctx, id, status)
}

// CancelTask cancels a task if it's not already in a terminal state.
func (s *TaskService) CancelTask(ctx context.Context, id string) error {
	task, err := s.db.GetTaskByID(ctx, id)
	if err != nil {
		return err
	}
	if task.Status == "completed" || task.Status == "archived" || task.Status == "cancelled" {
		return &store.ValidationError{Message: "cannot cancel task in " + task.Status + " status"}
	}
	return s.db.UpdateTaskStatus(ctx, id, "cancelled")
}

// CreateModule creates a new module under a task.
func (s *TaskService) CreateModule(ctx context.Context, taskID, name, description string) (*model.Module, error) {
	// Verify task exists
	if _, err := s.db.GetTaskByID(ctx, taskID); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	m := &model.Module{
		ID:          uuid.NewString(),
		TaskID:      taskID,
		Name:        name,
		Description: description,
		CreatedAt:   &now,
	}
	if err := s.db.InsertModule(ctx, m); err != nil {
		return nil, err
	}
	return m, nil
}

// ListModules returns all modules for a task.
func (s *TaskService) ListModules(ctx context.Context, taskID string) ([]*model.Module, error) {
	return s.db.ListModules(ctx, taskID)
}
