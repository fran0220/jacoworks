package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type RuleHandler struct {
	svc *service.RuleService
}

func NewRuleHandler(svc *service.RuleService) *RuleHandler {
	return &RuleHandler{svc: svc}
}

func (h *RuleHandler) GetMerged(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	taskID := r.URL.Query().Get("task_id")
	subTaskID := r.URL.Query().Get("sub_task_id")

	merged, err := h.svc.GetMergedRules(r.Context(), project, taskID, subTaskID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"rules": merged})
}

func (h *RuleHandler) List(w http.ResponseWriter, r *http.Request) {
	scope := r.URL.Query().Get("scope")
	project := r.URL.Query().Get("project")
	taskID := r.URL.Query().Get("task_id")

	rules, err := h.svc.ListRules(r.Context(), scope, project, taskID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

func (h *RuleHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rule, err := h.svc.GetRule(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

func (h *RuleHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Scope     string `json:"scope"`
		Content   string `json:"content"`
		Project   string `json:"project"`
		TaskID    string `json:"task_id"`
		SubTaskID string `json:"sub_task_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}

	rule, err := h.svc.CreateRule(r.Context(), req.Scope, req.Content, req.Project, req.TaskID, req.SubTaskID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, rule)
}

func (h *RuleHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Content string `json:"content"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if err := h.svc.UpdateRule(r.Context(), id, req.Content); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *RuleHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.svc.DeleteRule(r.Context(), id); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
