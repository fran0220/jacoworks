package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type TaskHandler struct {
	svc *service.TaskService
}

func NewTaskHandler(svc *service.TaskService) *TaskHandler {
	return &TaskHandler{svc: svc}
}

func (h *TaskHandler) Create(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())
	var req struct {
		Project     string `json:"project"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Type        string `json:"type"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	createdBy := ""
	if agent != nil {
		createdBy = agent.ID
	}

	task, err := h.svc.CreateTask(r.Context(), req.Project, req.Name, req.Description, req.Type, createdBy)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (h *TaskHandler) List(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	status := r.URL.Query().Get("status")
	keyword := r.URL.Query().Get("keyword")
	sortBy := getQueryParam(r, "sort_by", "created_at")
	sortOrder := getQueryParam(r, "sort_order", "DESC")
	page, pageSize := getPageParams(r)

	result, err := h.svc.ListTasks(r.Context(), project, status, keyword, page, pageSize, sortBy, sortOrder)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *TaskHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	task, err := h.svc.GetTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *TaskHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.UpdateTask(r.Context(), id, req.Name, req.Description); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *TaskHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Status string `json:"status"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.UpdateTaskStatus(r.Context(), id, req.Status); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *TaskHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.svc.CancelTask(r.Context(), id); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *TaskHandler) CreateModule(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	m, err := h.svc.CreateModule(r.Context(), taskID, req.Name, req.Description)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, m)
}

func (h *TaskHandler) ListModules(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	modules, err := h.svc.ListModules(r.Context(), taskID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, modules)
}
