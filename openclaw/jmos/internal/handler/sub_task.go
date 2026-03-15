package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type SubTaskHandler struct {
	svc *service.SubTaskService
}

func NewSubTaskHandler(svc *service.SubTaskService) *SubTaskHandler {
	return &SubTaskHandler{svc: svc}
}

func (h *SubTaskHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TaskID           string `json:"task_id"`
		ModuleID         string `json:"module_id"`
		Name             string `json:"name"`
		Description      string `json:"description"`
		Deliverable      string `json:"deliverable"`
		Acceptance       string `json:"acceptance"`
		Priority         string `json:"priority"`
		AssignedAgent    string `json:"assigned_agent"`
		Type             string `json:"type"`
		EstimatedMinutes int    `json:"estimated_minutes"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.TaskID == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "task_id and name are required")
		return
	}

	st, err := h.svc.CreateSubTask(r.Context(), service.CreateSubTaskParams{
		TaskID:           req.TaskID,
		ModuleID:         req.ModuleID,
		Name:             req.Name,
		Description:      req.Description,
		Deliverable:      req.Deliverable,
		Acceptance:       req.Acceptance,
		Priority:         req.Priority,
		AssignedAgent:    req.AssignedAgent,
		Type:             req.Type,
		EstimatedMinutes: req.EstimatedMinutes,
	})
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, st)
}

func (h *SubTaskHandler) List(w http.ResponseWriter, r *http.Request) {
	taskID := r.URL.Query().Get("task_id")
	moduleID := r.URL.Query().Get("module_id")
	status := r.URL.Query().Get("status")
	sortBy := getQueryParam(r, "sort_by", "created_at")
	sortOrder := getQueryParam(r, "sort_order", "DESC")
	page, pageSize := getPageParams(r)

	result, err := h.svc.ListSubTasks(r.Context(), taskID, moduleID, status, "", page, pageSize, sortBy, sortOrder)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *SubTaskHandler) Mine(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())
	if agent == nil {
		writeError(w, http.StatusUnauthorized, "agent required")
		return
	}
	status := r.URL.Query().Get("status")
	page, pageSize := getPageParams(r)

	result, err := h.svc.ListMySubTasks(r.Context(), agent.ID, status, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *SubTaskHandler) Available(w http.ResponseWriter, r *http.Request) {
	page, pageSize := getPageParams(r)
	result, err := h.svc.ListAvailable(r.Context(), page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *SubTaskHandler) Latest(w http.ResponseWriter, r *http.Request) {
	taskID := r.URL.Query().Get("task_id")
	agent := AgentFromContext(r.Context())
	agentID := ""
	if agent != nil {
		agentID = agent.ID
	}

	st, err := h.svc.GetLatest(r.Context(), taskID, agentID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	st, err := h.svc.GetSubTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req map[string]interface{}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	fields := make(map[string]any)
	for _, k := range []string{"name", "description", "deliverable", "acceptance", "priority"} {
		if v, ok := req[k]; ok {
			fields[k] = v
		}
	}
	if len(fields) == 0 {
		writeError(w, http.StatusBadRequest, "no updatable fields provided")
		return
	}

	if err := h.svc.UpdateSubTask(r.Context(), id, fields); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *SubTaskHandler) Claim(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agent := AgentFromContext(r.Context())
	if agent == nil {
		writeError(w, http.StatusUnauthorized, "agent required")
		return
	}
	var req struct {
		SessionID string `json:"session_id"`
	}
	readJSON(r, &req)

	st, err := h.svc.ClaimSubTask(r.Context(), id, agent.ID, req.SessionID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Start(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		SessionID string `json:"session_id"`
	}
	readJSON(r, &req)

	st, err := h.svc.StartSubTask(r.Context(), id, req.SessionID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Submit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	st, err := h.svc.SubmitSubTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Complete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	st, err := h.svc.CompleteSubTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Rework(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		ReworkAgent string `json:"rework_agent"`
	}
	readJSON(r, &req)

	st, err := h.svc.ReworkSubTask(r.Context(), id, req.ReworkAgent)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Block(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	st, err := h.svc.BlockSubTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Reassign(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		AgentID string `json:"agent_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "agent_id is required")
		return
	}
	st, err := h.svc.ReassignSubTask(r.Context(), id, req.AgentID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	st, err := h.svc.CancelSubTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *SubTaskHandler) UpdateSession(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		SessionID string `json:"session_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.UpdateSession(r.Context(), id, req.SessionID); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
