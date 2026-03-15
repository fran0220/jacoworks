package model

import "time"

type PatrolRecord struct {
	ID          string     `json:"id"`
	Type        string     `json:"type"`
	Severity    string     `json:"severity"`
	SubTaskID   string     `json:"sub_task_id"`
	AgentID     string     `json:"agent_id"`
	Description string     `json:"description"`
	ActionTaken string     `json:"action_taken"`
	Status      string     `json:"status"`
	CreatedAt   *time.Time `json:"created_at"`
	ResolvedAt  *time.Time `json:"resolved_at"`
}
