package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/config"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type AdminHandler struct {
	cfg      *config.Config
	db       *store.DB
	agent    *service.AgentService
	task     *service.TaskService
	subTask  *service.SubTaskService
	reward   *service.RewardService
	sessions *AdminSessionStore
}

func NewAdminHandler(
	cfg *config.Config,
	db *store.DB,
	agent *service.AgentService,
	task *service.TaskService,
	subTask *service.SubTaskService,
	reward *service.RewardService,
	sessions *AdminSessionStore,
) *AdminHandler {
	return &AdminHandler{
		cfg: cfg, db: db,
		agent: agent, task: task, subTask: subTask, reward: reward, sessions: sessions,
	}
}

func (h *AdminHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !adminPasswordMatches(h.cfg.Admin.Password, req.Password) {
		writeError(w, http.StatusUnauthorized, "invalid password")
		return
	}

	token, err := h.sessions.Create()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create admin session")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"token":   token,
		"message": "login successful",
	})
}

func (h *AdminHandler) ListTasks(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	status := r.URL.Query().Get("status")
	keyword := r.URL.Query().Get("keyword")
	sortBy := getQueryParam(r, "sort_by", "created_at")
	sortOrder := getQueryParam(r, "sort_order", "DESC")
	page, pageSize := getPageParams(r)

	result, err := h.task.ListTasks(r.Context(), project, status, keyword, page, pageSize, sortBy, sortOrder)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) GetTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	task, err := h.task.GetTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (h *AdminHandler) TaskSubTasks(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	status := r.URL.Query().Get("status")
	sortBy := getQueryParam(r, "sort_by", "created_at")
	sortOrder := getQueryParam(r, "sort_order", "DESC")
	page, pageSize := getPageParams(r)

	result, err := h.subTask.ListSubTasks(r.Context(), taskID, "", status, "", page, pageSize, sortBy, sortOrder)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) TaskModules(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	modules, err := h.task.ListModules(r.Context(), taskID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, modules)
}

func (h *AdminHandler) GetModule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	m, err := h.db.GetModuleByID(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *AdminHandler) ModuleSubTasks(w http.ResponseWriter, r *http.Request) {
	moduleID := chi.URLParam(r, "id")
	sortBy := getQueryParam(r, "sort_by", "created_at")
	sortOrder := getQueryParam(r, "sort_order", "DESC")
	page, pageSize := getPageParams(r)

	result, err := h.subTask.ListSubTasks(r.Context(), "", moduleID, "", "", page, pageSize, sortBy, sortOrder)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) ListSubTasks(w http.ResponseWriter, r *http.Request) {
	taskID := r.URL.Query().Get("task_id")
	moduleID := r.URL.Query().Get("module_id")
	status := r.URL.Query().Get("status")
	sortBy := getQueryParam(r, "sort_by", "created_at")
	sortOrder := getQueryParam(r, "sort_order", "DESC")
	page, pageSize := getPageParams(r)

	result, err := h.subTask.ListSubTasks(r.Context(), taskID, moduleID, status, "", page, pageSize, sortBy, sortOrder)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) GetSubTask(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	st, err := h.subTask.GetSubTask(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (h *AdminHandler) ListAgents(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	status := r.URL.Query().Get("status")
	agents, err := h.agent.ListAgents(r.Context(), role, status)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, agents)
}

func (h *AdminHandler) GetAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agents, err := h.agent.ListAgents(r.Context(), "", "")
	if err != nil {
		handleServiceError(w, err)
		return
	}
	for _, a := range agents {
		if a.ID == id {
			writeJSON(w, http.StatusOK, a)
			return
		}
	}
	writeError(w, http.StatusNotFound, "agent not found")
}

func (h *AdminHandler) CreateAgent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string `json:"name"`
		Role        string `json:"role"`
		Description string `json:"description"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Name == "" || req.Role == "" {
		writeError(w, http.StatusBadRequest, "name and role are required")
		return
	}
	agent, err := h.agent.RegisterAgent(r.Context(), req.Name, req.Role, req.Description)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, agent)
}

func (h *AdminHandler) UpdateAgentStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Status string `json:"status"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.agent.UpdateStatus(r.Context(), id, req.Status); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *AdminHandler) ResetKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	newKey, err := h.agent.ResetAPIKey(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"api_key": newKey})
}

func (h *AdminHandler) AgentScoreLogs(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	page, pageSize := getPageParams(r)
	result, err := h.reward.ListRewardLogs(r.Context(), agentID, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) AgentActivityLogs(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	days := getQueryInt(r, "days", 0)
	limit := getQueryInt(r, "limit", 100)
	logs, err := h.db.ListActivityLogs(r.Context(), agentID, "", "", days, limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (h *AdminHandler) AgentRequestLogs(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "id")
	limit := getQueryInt(r, "limit", 100)
	logs, err := h.db.ListRequestLogs(r.Context(), agentID, "", limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}
