package model

import "time"

type Event struct {
	Seq        int64      `json:"seq"`
	EventID    string     `json:"event_id"`
	Project    string     `json:"project"`
	Type       string     `json:"type"`
	ActorID    string     `json:"actor_id"`
	ActorName  string     `json:"actor_name"`
	ActorRole  string     `json:"actor_role"`
	TaskID     string     `json:"task_id"`
	SubTaskID  string     `json:"sub_task_id"`
	SessionID  string     `json:"session_id"`
	TargetType string     `json:"target_type"`
	TargetID   string     `json:"target_id"`
	TargetName string     `json:"target_name"`
	Action     string     `json:"action"`
	FromStatus string     `json:"from_status"`
	ToStatus   string     `json:"to_status"`
	Summary    string     `json:"summary"`
	Payload    string     `json:"payload"`
	Visual     string     `json:"visual"`
	CreatedAt  *time.Time `json:"created_at"`
}
