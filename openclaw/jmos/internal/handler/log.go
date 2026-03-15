package handler

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

var validLogActions = map[string]bool{
	"start": true, "complete": true, "submit": true, "review": true,
	"error": true, "info": true, "warning": true, "debug": true,
	"claim": true, "rework": true, "block": true, "cancel": true,
	"pause": true, "resume": true,
}

type LogHandler struct {
	db *store.DB
}

func NewLogHandler(db *store.DB) *LogHandler {
	return &LogHandler{db: db}
}

func (h *LogHandler) Create(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())
	if agent == nil {
		writeError(w, http.StatusUnauthorized, "agent required")
		return
	}

	var req struct {
		Action    string `json:"action"`
		Summary   string `json:"summary"`
		SubTaskID string `json:"sub_task_id"`
		SessionID string `json:"session_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Action == "" {
		writeError(w, http.StatusBadRequest, "action is required")
		return
	}
	if !validLogActions[req.Action] {
		writeError(w, http.StatusBadRequest, "invalid action: "+req.Action)
		return
	}

	now := time.Now().UTC()
	log := &model.ActivityLog{
		ID:        uuid.NewString(),
		AgentID:   agent.ID,
		SubTaskID: req.SubTaskID,
		Action:    req.Action,
		Summary:   req.Summary,
		SessionID: req.SessionID,
		CreatedAt: &now,
	}
	if err := h.db.InsertActivityLog(r.Context(), log); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, log)
}

func (h *LogHandler) List(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	subTaskID := r.URL.Query().Get("sub_task_id")
	action := r.URL.Query().Get("action")
	days := getQueryInt(r, "days", 0)
	limit := getQueryInt(r, "limit", 100)

	logs, err := h.db.ListActivityLogs(r.Context(), agentID, subTaskID, action, days, limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (h *LogHandler) Mine(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())
	if agent == nil {
		writeError(w, http.StatusUnauthorized, "agent required")
		return
	}
	action := r.URL.Query().Get("action")
	days := getQueryInt(r, "days", 0)
	limit := getQueryInt(r, "limit", 100)

	logs, err := h.db.ListMyActivityLogs(r.Context(), agent.ID, action, days, limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}
