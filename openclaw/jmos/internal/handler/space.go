package handler

import (
	"net/http"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type SpaceHandler struct {
	svc *service.SpaceService
}

func NewSpaceHandler(svc *service.SpaceService) *SpaceHandler {
	return &SpaceHandler{svc: svc}
}

func (h *SpaceHandler) Graph(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	graph, err := h.svc.BuildGraph(r.Context(), project)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, graph)
}

func (h *SpaceHandler) Pulse(w http.ResponseWriter, r *http.Request) {
	pulse, err := h.svc.GetPulse(r.Context())
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, pulse)
}

func (h *SpaceHandler) Orbits(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		writeError(w, http.StatusBadRequest, "agent_id is required")
		return
	}
	orbits, err := h.svc.GetOrbits(r.Context(), agentID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, orbits)
}
