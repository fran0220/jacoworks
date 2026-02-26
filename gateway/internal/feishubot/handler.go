package feishubot

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/openclaw"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	maxReplyLength     = 3000
	responseTimeout    = 120 * time.Second
	channelReadyWait   = 30 * time.Second
	defaultSessionKey  = "main"
	dedupTTL           = 30 * time.Minute
	dedupCleanInterval = 10 * time.Minute
)

var mentionPattern = regexp.MustCompile(`@_user_\d+\s*`)

// Handler processes Feishu webhook events and routes messages to OpenClaw containers
// via the shared ChannelPool (WebSocket protocol), enabling conversation sync with desktop.
type Handler struct {
	client      *Client
	store       *store.Store
	channelPool *openclaw.ChannelPool

	chatLocks       sync.Map // userID → *sync.Mutex (single-flight per user)
	processedEvents sync.Map // event_id → time.Time (webhook dedup)
}

func NewHandler(client *Client, s *store.Store, channelPool *openclaw.ChannelPool) *Handler {
	h := &Handler{
		client:      client,
		store:       s,
		channelPool: channelPool,
	}
	go h.cleanupLoop()
	return h
}

// --- Feishu event structures ---

type feishuEvent struct {
	Schema string          `json:"schema"`
	Header feishuHeader    `json:"header"`
	Event  json.RawMessage `json:"event"`
	// url_verification fields
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
}

type feishuHeader struct {
	EventID   string `json:"event_id"`
	EventType string `json:"event_type"`
	Token     string `json:"token"`
	AppID     string `json:"app_id"`
}

type messageEvent struct {
	Sender struct {
		SenderID struct {
			OpenID string `json:"open_id"`
		} `json:"sender_id"`
		SenderType string `json:"sender_type"`
	} `json:"sender"`
	Message struct {
		MessageID   string `json:"message_id"`
		ChatType    string `json:"chat_type"`
		MessageType string `json:"message_type"`
		Content     string `json:"content"`
	} `json:"message"`
}

// --- Webhook handler ---

func (h *Handler) HandleWebhook(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read body failed"})
		return
	}

	var event feishuEvent
	if err := json.Unmarshal(body, &event); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	// URL verification challenge
	if event.Type == "url_verification" {
		writeJSON(w, http.StatusOK, map[string]string{"challenge": event.Challenge})
		log.Info().Str("challenge", event.Challenge).Msg("feishu webhook: url verification")
		return
	}

	// Respond immediately (Feishu requires < 3s)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})

	// Deduplicate
	if event.Header.EventID != "" {
		if _, loaded := h.processedEvents.LoadOrStore(event.Header.EventID, time.Now()); loaded {
			log.Debug().Str("event_id", event.Header.EventID).Msg("feishu webhook: duplicate, skipping")
			return
		}
	}

	switch event.Header.EventType {
	case "im.message.receive_v1":
		go h.handleMessage(event.Event)
	default:
		log.Info().Str("event_type", event.Header.EventType).Msg("feishu webhook: unhandled event type")
	}
}

// --- Message processing (runs async in goroutine) ---

func (h *Handler) handleMessage(raw json.RawMessage) {
	var msg messageEvent
	if err := json.Unmarshal(raw, &msg); err != nil {
		log.Error().Err(err).Msg("feishu bot: parse message event failed")
		return
	}

	openID := msg.Sender.SenderID.OpenID
	messageID := msg.Message.MessageID

	log.Info().
		Str("open_id", openID).
		Str("message_id", messageID).
		Str("chat_type", msg.Message.ChatType).
		Str("message_type", msg.Message.MessageType).
		Msg("feishu bot: received message")

	if !h.client.IsConfigured() {
		log.Warn().Msg("feishu bot: credentials not configured, ignoring message")
		return
	}

	// Only handle text messages
	if msg.Message.MessageType != "text" {
		h.client.ReplyText(messageID, "暂时只支持文字消息哦 🙂")
		return
	}

	// Parse text content
	var content struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(msg.Message.Content), &content); err != nil {
		log.Error().Err(err).Str("content", msg.Message.Content).Msg("feishu bot: parse text failed")
		h.client.ReplyText(messageID, "消息解析失败，请重试")
		return
	}

	// Strip @mention patterns and trim
	text := mentionPattern.ReplaceAllString(content.Text, "")
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}

	// Look up user by feishu open_id
	ctx := context.Background()
	user, err := h.store.GetUserByFeishuID(ctx, openID)
	if err != nil {
		log.Warn().Str("open_id", openID).Msg("feishu bot: user not found")
		h.client.ReplyText(messageID, "您尚未绑定 JAcoworks 账号。请先通过飞书 SSO 登录桌面端完成绑定。")
		return
	}

	// Single-flight: one chat at a time per user
	lock := h.getChatLock(user.ID)
	lock.Lock()
	defer lock.Unlock()

	// Route message via OpenClaw channel (shared with desktop)
	response, err := h.routeViaChannel(ctx, user.ID, text)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("feishu bot: route via channel failed")
		h.client.ReplyText(messageID, "AI 处理消息时出错，请稍后重试。")
		return
	}

	// Save to DB session for desktop visibility
	h.syncSessionMessages(ctx, user.ID, text, response)

	// Truncate if too long
	if len(response) > maxReplyLength {
		response = response[:maxReplyLength] + "\n\n…(内容过长已截断)"
	}

	// Reply via Feishu
	if err := h.client.ReplyText(messageID, response); err != nil {
		log.Error().Err(err).Str("message_id", messageID).Msg("feishu bot: reply failed, trying send")
		if err := h.client.SendText(openID, response); err != nil {
			log.Error().Err(err).Str("open_id", openID).Msg("feishu bot: send fallback failed")
		}
	}

	log.Info().
		Str("user_id", user.ID).
		Str("open_id", openID).
		Int("response_len", len(response)).
		Msg("feishu bot: replied")
}

// --- Channel routing (replaces HTTP routeToContainer) ---

// routeViaChannel sends a message through the shared OpenClaw ChannelPool and
// collects the streaming response. This uses the same WS protocol as the desktop,
// ensuring conversation context (sessionKey) is shared between both channels.
func (h *Handler) routeViaChannel(ctx context.Context, userID, message string) (string, error) {
	channel, _, err := h.channelPool.GetOrCreate(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("get channel: %w", err)
	}

	// Subscribe to events (lastSeq=0 → no replay of old events)
	_, updates, unsubscribe := channel.Subscribe(0)
	defer unsubscribe()

	// Wait for channel to be connected if not already
	if !channel.Status().Connected {
		if err := waitForReady(updates); err != nil {
			return "", err
		}
	}

	// Generate unique request ID for correlation
	requestID := generateRequestID()

	// Build chat.send params (same protocol as desktop)
	params, _ := json.Marshal(map[string]interface{}{
		"sessionKey":     defaultSessionKey,
		"message":        message,
		"deliver":        true,
		"idempotencyKey": requestID,
	})

	// Send the request through the shared channel
	if err := channel.SendRequest("chat.send", params, requestID); err != nil {
		return "", fmt.Errorf("send chat.send: %w", err)
	}

	// Collect streaming response
	return collectResponse(updates, requestID)
}

// waitForReady blocks until the channel emits proxy.ready or times out.
func waitForReady(updates <-chan openclaw.SSEEvent) error {
	timeout := time.After(channelReadyWait)
	for {
		select {
		case event, ok := <-updates:
			if !ok {
				return fmt.Errorf("channel closed while waiting for ready")
			}
			if event.Event == "proxy.ready" {
				return nil
			}
			if event.Event == "proxy.error" {
				return fmt.Errorf("channel error while connecting")
			}
		case <-timeout:
			return fmt.Errorf("channel ready timeout (%v)", channelReadyWait)
		}
	}
}

// collectResponse waits for the chat.send response and collects streaming assistant
// content. It uses requestID gating: events before our request is accepted are skipped.
// Prefers chat.final text when available (authoritative), falls back to accumulated deltas.
func collectResponse(updates <-chan openclaw.SSEEvent, requestID string) (string, error) {
	var deltaBuf strings.Builder
	requestAccepted := false
	timeout := time.After(responseTimeout)

	for {
		select {
		case event, ok := <-updates:
			if !ok {
				if deltaBuf.Len() > 0 {
					return strings.TrimSpace(deltaBuf.String()), nil
				}
				return "", fmt.Errorf("channel closed during response collection")
			}

			switch event.Event {
			case "response":
				accepted, errMsg := parseResponseEvent(event.Data, requestID)
				if errMsg != "" {
					return "", fmt.Errorf("chat.send rejected: %s", errMsg)
				}
				if accepted {
					requestAccepted = true
				}

			case "agent":
				if !requestAccepted {
					continue
				}
				stream, delta, phase := parseAgentEvent(event.Data)
				switch stream {
				case "assistant":
					if delta != "" {
						deltaBuf.WriteString(delta)
					}
				case "lifecycle":
					if phase == "end" {
						return strings.TrimSpace(deltaBuf.String()), nil
					}
				}

			case "chat":
				if !requestAccepted {
					continue
				}
				if finalText := parseChatFinalEvent(event.Data); finalText != "" {
					return strings.TrimSpace(finalText), nil
				}
			}

		case <-timeout:
			if deltaBuf.Len() > 0 {
				return strings.TrimSpace(deltaBuf.String()), nil
			}
			return "", fmt.Errorf("response timeout (%v)", responseTimeout)
		}
	}
}

// --- DB session sync ---

// syncSessionMessages appends the user message and assistant reply to the user's
// cowork session in the database, so the desktop can see feishu conversations.
func (h *Handler) syncSessionMessages(ctx context.Context, userID, userMessage, assistantReply string) {
	if assistantReply == "" {
		return
	}

	sessionID, err := h.findOrCreateCoworkSession(ctx, userID)
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("feishu bot: session sync failed")
		return
	}

	sess, err := h.store.GetSession(ctx, userID, sessionID)
	if err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("feishu bot: get session failed")
		return
	}

	var messages []map[string]interface{}
	if len(sess.Messages) > 0 {
		_ = json.Unmarshal(sess.Messages, &messages)
	}

	now := time.Now().UnixMilli()
	messages = append(messages,
		map[string]interface{}{
			"id": generateMsgID(), "role": "user",
			"content": userMessage, "createdAt": now, "status": "final",
		},
		map[string]interface{}{
			"id": generateMsgID(), "role": "assistant",
			"content": assistantReply, "createdAt": now, "status": "final",
		},
	)

	msgJSON, _ := json.Marshal(messages)
	msgStr := string(msgJSON)

	title := sess.Title
	if title == "" || title == "新对话" || title == "新会话" {
		title = truncateTitle(userMessage)
	}

	if _, err := h.store.UpdateSession(ctx, userID, sessionID, store.SessionUpdate{
		Messages: &msgStr,
		Title:    &title,
	}); err != nil {
		log.Error().Err(err).Str("session_id", sessionID).Msg("feishu bot: save messages failed")
	}
}

func (h *Handler) findOrCreateCoworkSession(ctx context.Context, userID string) (string, error) {
	sessions, err := h.store.ListSessions(ctx, userID)
	if err != nil {
		return "", err
	}

	for _, s := range sessions {
		if s.Type == "cowork" {
			return s.ID, nil
		}
	}

	sess, err := h.store.CreateSession(ctx, userID, "cowork", "", "")
	if err != nil {
		return "", err
	}
	return sess.ID, nil
}

// --- Event parsing helpers ---

// parseResponseEvent checks if a "response" event matches our requestID.
// Returns (accepted, errorMessage).
func parseResponseEvent(data []byte, requestID string) (bool, string) {
	var env struct {
		ID    string          `json:"id"`
		OK    bool            `json:"ok"`
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(data, &env) != nil {
		return false, ""
	}
	if env.ID != requestID {
		return false, ""
	}
	if len(env.Error) > 0 && string(env.Error) != "null" {
		var errObj struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(env.Error, &errObj) == nil && errObj.Message != "" {
			return false, errObj.Message
		}
		return false, string(env.Error)
	}
	return env.OK, ""
}

// parseAgentEvent extracts stream type, delta text, and lifecycle phase from an agent event.
func parseAgentEvent(data []byte) (stream, delta, phase string) {
	var env struct {
		Payload struct {
			Stream string `json:"stream"`
			Data   struct {
				Delta string `json:"delta"`
				Phase string `json:"phase"`
			} `json:"data"`
		} `json:"payload"`
	}
	if json.Unmarshal(data, &env) != nil {
		return "", "", ""
	}
	return env.Payload.Stream, env.Payload.Data.Delta, env.Payload.Data.Phase
}

// parseChatFinalEvent extracts the final message text from a chat event with state:"final".
func parseChatFinalEvent(data []byte) string {
	var env struct {
		Payload struct {
			State   string `json:"state"`
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"payload"`
	}
	if json.Unmarshal(data, &env) != nil || env.Payload.State != "final" {
		return ""
	}

	raw := env.Payload.Message.Content
	if len(raw) == 0 {
		return ""
	}

	// Content can be a plain string
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}

	// Or an array of content parts [{text: "..."}, ...]
	var parts []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) == nil {
		var buf strings.Builder
		for _, p := range parts {
			buf.WriteString(p.Text)
		}
		return buf.String()
	}

	return ""
}

// --- Helpers ---

func (h *Handler) getChatLock(userID string) *sync.Mutex {
	v, _ := h.chatLocks.LoadOrStore(userID, &sync.Mutex{})
	return v.(*sync.Mutex)
}

func (h *Handler) cleanupLoop() {
	ticker := time.NewTicker(dedupCleanInterval)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-dedupTTL)
		h.processedEvents.Range(func(key, value interface{}) bool {
			if t, ok := value.(time.Time); ok && t.Before(cutoff) {
				h.processedEvents.Delete(key)
			}
			return true
		})
	}
}

func generateRequestID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "feishu-" + hex.EncodeToString(b)
}

func generateMsgID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func truncateTitle(text string) string {
	cleaned := strings.NewReplacer("\n", " ", "*", "", "_", "", "~", "", "`", "", "#", "").Replace(text)
	cleaned = strings.TrimSpace(cleaned)
	if cleaned == "" {
		return "飞书对话"
	}
	runes := []rune(cleaned)
	if len(runes) <= 20 {
		return cleaned
	}
	return string(runes[:20]) + "..."
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}
