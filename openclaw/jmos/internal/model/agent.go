package model

import "time"

type Agent struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Role             string     `json:"role"`
	Description      string     `json:"description"`
	Status           string     `json:"status"`
	APIKey           string     `json:"api_key,omitempty"`
	TotalScore       int        `json:"total_score"`
	Capabilities     string     `json:"capabilities"`
	AvatarSeed       string     `json:"avatar_seed"`
	CurrentAction    string     `json:"current_action"`
	CurrentSubTaskID string     `json:"current_sub_task_id"`
	CurrentSessionID string     `json:"current_session_id"`
	LastSeenAt       *time.Time `json:"last_seen_at"`
	CreatedAt        *time.Time `json:"created_at"`
}
