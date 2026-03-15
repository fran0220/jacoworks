package handler

import (
	"net/http"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/config"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type FeedHandler struct {
	db  *store.DB
	cfg *config.Config
}

func NewFeedHandler(db *store.DB, cfg *config.Config) *FeedHandler {
	return &FeedHandler{db: db, cfg: cfg}
}

func (h *FeedHandler) Status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"public_feed":         h.cfg.WebUI.PublicFeed,
		"feed_retention_days": h.cfg.WebUI.FeedRetentionDays,
	})
}

func (h *FeedHandler) Logs(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.WebUI.PublicFeed {
		writeError(w, http.StatusForbidden, "public feed is disabled")
		return
	}
	limit := getQueryInt(r, "limit", 50)
	logs, err := h.db.ListRequestLogs(r.Context(), "", "", limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (h *FeedHandler) Agents(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.WebUI.PublicFeed {
		writeError(w, http.StatusForbidden, "public feed is disabled")
		return
	}
	agents, err := h.db.ListAgents(r.Context(), "", "")
	if err != nil {
		handleServiceError(w, err)
		return
	}

	type safeAgent struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Role        string `json:"role"`
		Status      string `json:"status"`
		TotalScore  int    `json:"total_score"`
		Description string `json:"description"`
	}
	result := make([]safeAgent, 0, len(agents))
	for _, a := range agents {
		result = append(result, safeAgent{
			ID: a.ID, Name: a.Name, Role: a.Role,
			Status: a.Status, TotalScore: a.TotalScore,
			Description: a.Description,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *FeedHandler) AgentSummary(w http.ResponseWriter, r *http.Request) {
	agents, err := h.db.ListAgents(r.Context(), "", "")
	if err != nil {
		handleServiceError(w, err)
		return
	}

	type summary struct {
		Total   int            `json:"total"`
		Online  int            `json:"online"`
		ByRole  map[string]int `json:"by_role"`
		ByState map[string]int `json:"by_state"`
	}
	s := summary{
		Total:   len(agents),
		ByRole:  make(map[string]int),
		ByState: make(map[string]int),
	}
	for _, a := range agents {
		s.ByRole[a.Role]++
		s.ByState[a.Status]++
		if a.Status != "offline" {
			s.Online++
		}
	}
	writeJSON(w, http.StatusOK, s)
}
