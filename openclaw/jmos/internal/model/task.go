package model

import "time"

type Task struct {
	ID          string     `json:"id"`
	Project     string     `json:"project"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Type        string     `json:"type"`
	Status      string     `json:"status"`
	CreatedBy   string     `json:"created_by"`
	Deadline    *time.Time `json:"deadline"`
	Tags        string     `json:"tags"`
	Metadata    string     `json:"metadata"`
	CreatedAt   *time.Time `json:"created_at"`
	UpdatedAt   *time.Time `json:"updated_at"`
	CompletedAt *time.Time `json:"completed_at"`
}
