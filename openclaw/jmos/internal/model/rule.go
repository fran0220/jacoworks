package model

import "time"

type Rule struct {
	ID        string     `json:"id"`
	Scope     string     `json:"scope"`
	Project   string     `json:"project"`
	TaskID    string     `json:"task_id"`
	SubTaskID string     `json:"sub_task_id"`
	Content   string     `json:"content"`
	CreatedAt *time.Time `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at"`
}
