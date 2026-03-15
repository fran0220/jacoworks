package model

import "time"

type ActivityLog struct {
	ID        string     `json:"id"`
	AgentID   string     `json:"agent_id"`
	SubTaskID string     `json:"sub_task_id"`
	Action    string     `json:"action"`
	Summary   string     `json:"summary"`
	SessionID string     `json:"session_id"`
	CreatedAt *time.Time `json:"created_at"`
}
