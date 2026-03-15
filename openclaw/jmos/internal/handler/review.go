package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type ReviewHandler struct {
	svc *service.ReviewService
}

func NewReviewHandler(svc *service.ReviewService) *ReviewHandler {
	return &ReviewHandler{svc: svc}
}

func (h *ReviewHandler) Create(w http.ResponseWriter, r *http.Request) {
	agent := AgentFromContext(r.Context())
	if agent == nil {
		writeError(w, http.StatusUnauthorized, "agent required")
		return
	}

	var req struct {
		SubTaskID string `json:"sub_task_id"`
		Result    string `json:"result"`
		Score     int    `json:"score"`
		Issues    string `json:"issues"`
		Comment   string `json:"comment"`
		ReworkAgent string `json:"rework_agent"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.SubTaskID == "" {
		writeError(w, http.StatusBadRequest, "sub_task_id is required")
		return
	}

	record, err := h.svc.CreateReview(r.Context(), service.CreateReviewParams{
		SubTaskID:     req.SubTaskID,
		ReviewerAgent: agent.ID,
		Result:        req.Result,
		Score:         req.Score,
		Issues:        req.Issues,
		Comment:       req.Comment,
		ReworkAgent:   req.ReworkAgent,
	})
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (h *ReviewHandler) List(w http.ResponseWriter, r *http.Request) {
	subTaskID := r.URL.Query().Get("sub_task_id")
	page, pageSize := getPageParams(r)

	result, err := h.svc.ListReviews(r.Context(), subTaskID, page, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *ReviewHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	record, err := h.svc.GetReview(r.Context(), id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}
