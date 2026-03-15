package model

import "time"

type Module struct {
	ID          string     `json:"id"`
	TaskID      string     `json:"task_id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	SortOrder   int        `json:"sort_order"`
	CreatedAt   *time.Time `json:"created_at"`
}
