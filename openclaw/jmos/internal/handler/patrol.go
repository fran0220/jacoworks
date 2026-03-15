package handler

import (
	"net/http"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type PatrolHandler struct {
	svc *service.PatrolService
}

func NewPatrolHandler(svc *service.PatrolService) *PatrolHandler {
	return &PatrolHandler{svc: svc}
}

func (h *PatrolHandler) Report(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())

	var req struct {
		Type        string `json:"type"`
		Severity    string `json:"severity"`
		SubTaskID   string `json:"sub_task_id"`
		Description string `json:"description"`
		ActionTaken string `json:"action_taken"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Type == "" || req.Severity == "" || req.Description == "" {
		writeError(w, http.StatusBadRequest, "type, severity, and description are required")
		return
	}

	agentID := ""
	if agent != nil {
		agentID = agent.ID
	}

	record, err := h.svc.ReportPatrol(r.Context(), req.Type, req.Severity, req.SubTaskID, agentID, req.Description, req.ActionTaken)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (h *PatrolHandler) Active(w http.ResponseWriter, r *http.Request) {
	records, err := h.svc.ListActivePatrols(r.Context())
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, records)
}

func (h *PatrolHandler) List(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	page, pageSize := getPageParams(r)

	result, err := h.svc.ListPatrols(r.Context(), status, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
