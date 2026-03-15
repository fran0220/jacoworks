package handler

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

type ScoreHandler struct {
	reward *service.RewardService
	db     *store.DB
}

func NewScoreHandler(reward *service.RewardService, db *store.DB) *ScoreHandler {
	return &ScoreHandler{reward: reward, db: db}
}

func (h *ScoreHandler) Leaderboard(w http.ResponseWriter, r *http.Request) {
	agents, err := h.db.ListAgents(r.Context(), "", "")
	if err != nil {
		handleServiceError(w, err)
		return
	}

	type entry struct {
		AgentID    string `json:"agent_id"`
		AgentName  string `json:"agent_name"`
		Role       string `json:"role"`
		TotalScore int    `json:"total_score"`
		Rank       int    `json:"rank"`
	}

	entries := make([]entry, 0, len(agents))
	for _, a := range agents {
		entries = append(entries, entry{
			AgentID:    a.ID,
			AgentName:  a.Name,
			Role:       a.Role,
			TotalScore: a.TotalScore,
		})
	}
	// Assign ranks
	for i := range entries {
		rank := 1
		for j := range entries {
			if entries[j].TotalScore > entries[i].TotalScore {
				rank++
			}
		}
		entries[i].Rank = rank
	}

	writeJSON(w, http.StatusOK, entries)
}

func (h *ScoreHandler) Me(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())
	if agent == nil {
		writeError(w, http.StatusUnauthorized, "agent required")
		return
	}
	summary, err := h.reward.GetAgentScore(r.Context(), agent.ID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *ScoreHandler) MeLogs(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())
	if agent == nil {
		writeError(w, http.StatusUnauthorized, "agent required")
		return
	}
	page, pageSize := getPageParams(r)
	result, err := h.reward.ListRewardLogs(r.Context(), agent.ID, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *ScoreHandler) AgentScore(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agent_id")
	summary, err := h.reward.GetAgentScore(r.Context(), agentID)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *ScoreHandler) AgentLogs(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agent_id")
	page, pageSize := getPageParams(r)
	result, err := h.reward.ListRewardLogs(r.Context(), agentID, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *ScoreHandler) Adjust(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AgentID   string `json:"agent_id"`
		Reason    string `json:"reason"`
		Delta     int    `json:"delta"`
		SubTaskID string `json:"sub_task_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.AgentID == "" || req.Reason == "" || req.Delta == 0 {
		writeError(w, http.StatusBadRequest, "agent_id, reason, and non-zero delta are required")
		return
	}

	err := h.db.WithTx(r.Context(), func(tx *sql.Tx) error {
		return h.reward.AddReward(r.Context(), tx, req.AgentID, req.Reason, req.Delta, req.SubTaskID)
	})
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "id": uuid.NewString()})
}
