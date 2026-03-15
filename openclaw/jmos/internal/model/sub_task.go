package model

import "time"

type SubTask struct {
	ID               string     `json:"id"`
	TaskID           string     `json:"task_id"`
	ModuleID         string     `json:"module_id"`
	Name             string     `json:"name"`
	Description      string     `json:"description"`
	Deliverable      string     `json:"deliverable"`
	Acceptance       string     `json:"acceptance"`
	Type             string     `json:"type"`
	Status           string     `json:"status"`
	Priority         string     `json:"priority"`
	AssignedAgent    string     `json:"assigned_agent"`
	CurrentSessionID string     `json:"current_session_id"`
	ReworkCount      int        `json:"rework_count"`
	EstimatedMinutes int        `json:"estimated_minutes"`
	ActualMinutes    int        `json:"actual_minutes"`
	RecurringConfig  string     `json:"recurring_config"`
	Tags             string     `json:"tags"`
	Deadline         *time.Time `json:"deadline"`
	CreatedAt        *time.Time `json:"created_at"`
	UpdatedAt        *time.Time `json:"updated_at"`
	StartedAt        *time.Time `json:"started_at"`
	CompletedAt      *time.Time `json:"completed_at"`
}
