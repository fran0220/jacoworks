package model

import "time"

type RequestLog struct {
	ID             string     `json:"id"`
	Timestamp      *time.Time `json:"timestamp"`
	Method         string     `json:"method"`
	Path           string     `json:"path"`
	AgentID        string     `json:"agent_id"`
	AgentName      string     `json:"agent_name"`
	AgentRole      string     `json:"agent_role"`
	RequestBody    string     `json:"request_body"`
	ResponseStatus int        `json:"response_status"`
}
