package handler

import (
	"net/http"
	"time"

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
		"enabled":             h.cfg.WebUI.PublicFeed,
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
	agentID := r.URL.Query().Get("agent_id")
	after := r.URL.Query().Get("after")
	logs, err := h.db.ListRequestLogs(r.Context(), agentID, after, limit)
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

	agentIDs := make([]string, len(agents))
	for i, a := range agents {
		agentIDs[i] = a.ID
	}

	todayRequests, _ := h.db.CountTodayByAgent(r.Context(), agentIDs)
	todaySubmits, _ := h.db.CountTodaySubmitsByAgent(r.Context(), agentIDs)
	todayReviews, _ := h.db.CountTodayReviewsByAgent(r.Context(), agentIDs)

	type subTaskBrief struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		ModuleName *string `json:"module_name"`
	}
	type recentAction struct {
		Method         string  `json:"method"`
		Path           string  `json:"path"`
		RequestBody    *string `json:"request_body"`
		ResponseStatus *int    `json:"response_status"`
		Timestamp      *string `json:"timestamp"`
	}
	type agentSummary struct {
		ID                string         `json:"id"`
		Name              string         `json:"name"`
		Role              string         `json:"role"`
		TotalScore        int            `json:"total_score"`
		TodayRequestCount int            `json:"today_request_count"`
		TodaySubmitCount  int            `json:"today_submit_count"`
		TodayReviewCount  int            `json:"today_review_count"`
		CurrentSubTask    *subTaskBrief  `json:"current_sub_task"`
		RecentActions     []recentAction `json:"recent_actions"`
	}

	result := make([]agentSummary, 0, len(agents))
	for _, a := range agents {
		s := agentSummary{
			ID:                a.ID,
			Name:              a.Name,
			Role:              a.Role,
			TotalScore:        a.TotalScore,
			TodayRequestCount: todayRequests[a.ID],
			TodaySubmitCount:  todaySubmits[a.ID],
			TodayReviewCount:  todayReviews[a.ID],
			RecentActions:     []recentAction{},
		}

		if a.CurrentSubTaskID != "" {
			if st, err := h.db.GetSubTaskByID(r.Context(), a.CurrentSubTaskID); err == nil {
				brief := &subTaskBrief{ID: st.ID, Name: st.Name}
				if st.ModuleID != "" {
					if mod, err := h.db.GetModuleByID(r.Context(), st.ModuleID); err == nil {
						brief.ModuleName = &mod.Name
					}
				}
				s.CurrentSubTask = brief
			}
		}

		if logs, err := h.db.ListRequestLogs(r.Context(), a.ID, "", 5); err == nil {
			for _, l := range logs {
				ra := recentAction{Method: l.Method, Path: l.Path}
				if l.RequestBody != "" {
					body := l.RequestBody
					ra.RequestBody = &body
				}
				if l.ResponseStatus != 0 {
					status := l.ResponseStatus
					ra.ResponseStatus = &status
				}
				if l.Timestamp != nil {
					ts := l.Timestamp.Format(time.RFC3339)
					ra.Timestamp = &ts
				}
				s.RecentActions = append(s.RecentActions, ra)
			}
		}

		result = append(result, s)
	}
	writeJSON(w, http.StatusOK, result)
}
