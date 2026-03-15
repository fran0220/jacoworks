package handler

import (
	"net/http"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type StatsHandler struct {
	db *store.DB
}

func NewStatsHandler(db *store.DB) *StatsHandler {
	return &StatsHandler{db: db}
}

func (h *StatsHandler) Overview(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	overview, err := h.db.GetOverview(r.Context(), project)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (h *StatsHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	days := getQueryInt(r, "days", 7)
	bucket := getQueryParam(r, "bucket", "day")

	timeline, err := h.db.GetTimeline(r.Context(), project, days, bucket)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, timeline)
}

func (h *StatsHandler) Flow(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	days := getQueryInt(r, "days", 30)

	flow, err := h.db.GetStateFlow(r.Context(), project, days)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, flow)
}

func (h *StatsHandler) Distribution(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	dist, err := h.db.GetDistribution(r.Context(), project)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dist)
}

func (h *StatsHandler) Agents(w http.ResponseWriter, r *http.Request) {
	project := r.URL.Query().Get("project")
	ranking, err := h.db.GetAgentRanking(r.Context(), project)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ranking)
}

func (h *StatsHandler) AgentHeatmap(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	if agentID == "" {
		writeError(w, http.StatusBadRequest, "agent_id is required")
		return
	}
	days := getQueryInt(r, "days", 7)
	matrix, err := h.db.GetAgentHeatmap(r.Context(), agentID, days)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, matrix)
}
