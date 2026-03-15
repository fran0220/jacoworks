package handler

import (
	"net/http"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
)

type EventHandler struct {
	svc *service.EventService
}

func NewEventHandler(svc *service.EventService) *EventHandler {
	return &EventHandler{svc: svc}
}

func (h *EventHandler) List(w http.ResponseWriter, r *http.Request) {
	afterSeq := int64(getQueryInt(r, "after_seq", 0))
	limit := getQueryInt(r, "limit", 50)

	result, err := h.svc.ListEvents(r.Context(), afterSeq, limit)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
