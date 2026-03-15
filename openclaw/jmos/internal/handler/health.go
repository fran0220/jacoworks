package handler

import (
	"net/http"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/config"
)

type HealthHandler struct {
	cfg *config.Config
}

func NewHealthHandler(cfg *config.Config) *HealthHandler {
	return &HealthHandler{cfg: cfg}
}

func (h *HealthHandler) Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "JMOS",
		"version": "1.0.0",
	})
}

func (h *HealthHandler) NotificationConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":  h.cfg.Notification.Enabled,
		"channels": h.cfg.Notification.Channels,
		"events":   h.cfg.Notification.Events,
	})
}
