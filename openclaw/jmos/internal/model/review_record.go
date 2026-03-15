package model

import "time"

type ReviewRecord struct {
	ID            string     `json:"id"`
	SubTaskID     string     `json:"sub_task_id"`
	ReviewerAgent string     `json:"reviewer_agent"`
	Round         int        `json:"round"`
	Result        string     `json:"result"`
	Score         int        `json:"score"`
	Issues        string     `json:"issues"`
	Comment       string     `json:"comment"`
	ReworkAgent   string     `json:"rework_agent"`
	CreatedAt     *time.Time `json:"created_at"`
}
