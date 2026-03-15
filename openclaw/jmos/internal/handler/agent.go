package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type AgentHandler struct {
	svc *service.AgentService
	cfg agentHandlerConfig
}

type agentHandlerConfig struct {
	RegistrationToken string
	AllowRegistration bool
}

func NewAgentHandler(svc *service.AgentService, registrationToken string, allowRegistration bool) *AgentHandler {
	return &AgentHandler{
		svc: svc,
		cfg: agentHandlerConfig{
			RegistrationToken: registrationToken,
			AllowRegistration: allowRegistration,
		},
	}
}

func (h *AgentHandler) Register(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.AllowRegistration {
		writeError(w, http.StatusForbidden, "agent registration is disabled")
		return
	}

	token := r.Header.Get("X-Registration-Token")
	if token == "" || token != h.cfg.RegistrationToken {
		writeError(w, http.StatusUnauthorized, "invalid registration token")
		return
	}

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

	agent, err := h.svc.RegisterAgent(r.Context(), req.Name, req.Role, req.Description)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, agent)
}

func (h *AgentHandler) Create(w http.ResponseWriter, r *http.Request) {
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

	agent, err := h.svc.RegisterAgent(r.Context(), req.Name, req.Role, req.Description)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, agent)
}

func (h *AgentHandler) List(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	status := r.URL.Query().Get("status")

	agents, err := h.svc.ListAgents(r.Context(), role, status)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	// Strip API keys from list response
	type safeAgent struct {
		ID               string `json:"id"`
		Name             string `json:"name"`
		Role             string `json:"role"`
		Description      string `json:"description"`
		Status           string `json:"status"`
		TotalScore       int    `json:"total_score"`
		CurrentAction    string `json:"current_action"`
		CurrentSubTaskID string `json:"current_sub_task_id"`
	}
	result := make([]safeAgent, 0, len(agents))
	for _, a := range agents {
		result = append(result, safeAgent{
			ID: a.ID, Name: a.Name, Role: a.Role, Description: a.Description,
			Status: a.Status, TotalScore: a.TotalScore,
			CurrentAction: a.CurrentAction, CurrentSubTaskID: a.CurrentSubTaskID,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *AgentHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agents, err := h.svc.ListAgents(r.Context(), "", "")
	if err != nil {
		handleServiceError(w, err)
		return
	}
	for _, a := range agents {
		if a.ID == id {
			a.APIKey = "" // strip key
			writeJSON(w, http.StatusOK, a)
			return
		}
	}
	writeError(w, http.StatusNotFound, "agent not found")
}

func (h *AgentHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Status string `json:"status"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.svc.UpdateStatus(r.Context(), id, req.Status); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *AgentHandler) Pulse(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req service.PulseRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	statusChanged, err := h.svc.UpdatePulse(r.Context(), id, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":         "ok",
		"status_changed": statusChanged,
	})
}
