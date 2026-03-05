package agent

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
)

// SSEHandler exposes vm-agent channel adapter endpoints for desktop clients.
type SSEHandler struct {
	pool *ChannelPool
}

func NewSSEHandler(pool *ChannelPool) *SSEHandler {
	return &SSEHandler{pool: pool}
}

func (h *SSEHandler) StreamEvents(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeSSEJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeSSEJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming unsupported"})
		return
	}

	channel, _, err := h.pool.GetOrCreate(r.Context(), user.ID)
	if err != nil {
		writeSSEJSON(w, http.StatusBadGateway, map[string]string{"error": "no container provisioned"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	lastSeq := parseLastEventID(r)
	replay, updates, unsubscribe := channel.Subscribe(lastSeq)
	defer unsubscribe()

	for _, event := range replay {
		if err := writeSSEEvent(w, flusher, event); err != nil {
			return
		}
	}

	if status := channel.Status(); status.Connected {
		readyPayload, _ := json.Marshal(map[string]string{"type": "proxy.ready"})
		if err := writeSSEEvent(w, flusher, Event{Event: "proxy.ready", Data: readyPayload}); err != nil {
			return
		}
	}

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case event, ok := <-updates:
			if !ok {
				return
			}
			if err := writeSSEEvent(w, flusher, event); err != nil {
				return
			}
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// SendCommand sends a vm-agent protocol message via the channel.
// Accepts {"type":"prompt","message":"...",...} format.
func (h *SSEHandler) SendCommand(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeSSEJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req struct {
		Type    string          `json:"type"`
		Message string          `json:"message"`
		Raw     json.RawMessage `json:"-"`
	}

	// Read raw body for forwarding
	var rawBody json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&rawBody); err != nil {
		writeSSEJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if err := json.Unmarshal(rawBody, &req); err != nil {
		writeSSEJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	msgType := req.Type
	if strings.TrimSpace(msgType) == "" {
		msgType = "prompt"
	}

	channel, _, err := h.pool.GetOrCreate(r.Context(), user.ID)
	if err != nil {
		writeSSEJSON(w, http.StatusBadGateway, map[string]string{"error": "no container provisioned"})
		return
	}

	requestID, err := newRequestID()
	if err != nil {
		writeSSEJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to allocate request id"})
		return
	}

	err = channel.SendRequest(msgType, rawBody, requestID)
	if err != nil {
		if errors.Is(err, ErrChannelReconnecting) || errors.Is(err, ErrChannelNotConnected) {
			writeSSEJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "agent reconnecting"})
			return
		}
		writeSSEJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to send command"})
		return
	}

	writeSSEJSON(w, http.StatusOK, map[string]interface{}{
		"ok":        true,
		"requestId": requestID,
	})
}

func (h *SSEHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeSSEJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	containerName := ""
	if info, err := h.pool.ContainerInfo(r.Context(), user.ID); err == nil {
		containerName = info.ContainerName
	}

	status := ChannelStatus{ContainerName: containerName}
	if ch := h.pool.Get(user.ID); ch != nil {
		status = ch.Status()
		if status.ContainerName == "" {
			status.ContainerName = containerName
		}
	}

	writeSSEJSON(w, http.StatusOK, map[string]interface{}{
		"connected":     status.Connected,
		"reconnecting":  status.Reconnecting,
		"containerName": status.ContainerName,
	})
}

func parseLastEventID(r *http.Request) uint64 {
	raw := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if raw == "" {
		raw = strings.TrimSpace(r.URL.Query().Get("lastEventId"))
	}
	if raw == "" {
		return 0
	}
	seq, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0
	}
	return seq
}

func writeSSEEvent(w http.ResponseWriter, flusher http.Flusher, event Event) error {
	if event.Seq > 0 {
		if _, err := fmt.Fprintf(w, "id: %d\n", event.Seq); err != nil {
			return err
		}
	}

	if event.Event == "" {
		event.Event = "message"
	}
	if _, err := fmt.Fprintf(w, "event: %s\n", event.Event); err != nil {
		return err
	}

	data := event.Data
	if len(data) == 0 {
		data = []byte("{}")
	}
	for _, line := range bytes.Split(data, []byte("\n")) {
		if _, err := fmt.Fprintf(w, "data: %s\n", line); err != nil {
			return err
		}
	}

	if _, err := fmt.Fprint(w, "\n"); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func writeSSEJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func newRequestID() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "ag-" + hex.EncodeToString(b), nil
}
