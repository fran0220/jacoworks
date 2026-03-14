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

	"github.com/fran0220/jacoworks/gateway/internal/agent"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	maxReplyLength        = 3000
	responseTimeout       = 120 * time.Second
	channelReadyWait      = 30 * time.Second
	openClawChallengeWait = 5 * time.Second
	openClawConnectWait   = 10 * time.Second
	defaultSessionKey     = "agent:default:main"
	dedupTTL              = 30 * time.Minute
	dedupCleanInterval    = 10 * time.Minute
)

var mentionPattern = regexp.MustCompile(`@_user_\d+\s*`)

// imageAttachment holds downloaded image data for inline inclusion in agent prompts.
type imageAttachment struct {
	URL string // descriptive label (e.g. image_key + extension)
}

// Handler processes Feishu webhook events and routes messages to OpenClaw containers
// via the shared ChannelPool (WebSocket protocol), enabling conversation sync with webchat.
type Handler struct {
	client      *Client
	store       *store.Store
	channelPool *agent.ChannelPool

	chatLocks       sync.Map // userID → *sync.Mutex (single-flight per user)
	processedEvents sync.Map // event_id → time.Time (webhook dedup)
}

func NewHandler(client *Client, s *store.Store, channelPool *agent.ChannelPool) *Handler {
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

	// Handle supported message types
	var text string
	var attachments []imageAttachment

	switch msg.Message.MessageType {
	case "text":
		var content struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(msg.Message.Content), &content); err != nil {
			log.Error().Err(err).Str("content", msg.Message.Content).Msg("feishu bot: parse text failed")
			h.client.ReplyText(messageID, "消息解析失败，请重试")
			return
		}
		text = mentionPattern.ReplaceAllString(content.Text, "")
		text = strings.TrimSpace(text)

	case "image":
		var content struct {
			ImageKey string `json:"image_key"`
		}
		if err := json.Unmarshal([]byte(msg.Message.Content), &content); err != nil {
			log.Error().Err(err).Str("content", msg.Message.Content).Msg("feishu bot: parse image content failed")
			h.client.ReplyText(messageID, "图片解析失败，请重试")
			return
		}
		imgData, err := h.client.DownloadImage(messageID, content.ImageKey)
		if err != nil {
			log.Error().Err(err).Str("image_key", content.ImageKey).Msg("feishu bot: download image failed")
			h.client.ReplyText(messageID, "图片下载失败，请重试")
			return
		}
		mimeType := http.DetectContentType(imgData)
		attachments = append(attachments, imageAttachment{
			URL: content.ImageKey + mimeExtension(mimeType),
		})
		text = "请查看这张图片"
		log.Info().Str("image_key", content.ImageKey).Int("size", len(imgData)).Str("mime", mimeType).Msg("feishu bot: image downloaded")

	default:
		h.client.ReplyText(messageID, "暂时只支持文字和图片消息哦 🙂")
		return
	}

	if text == "" && len(attachments) == 0 {
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

	// Route message via agent channel (shared with desktop)
	response, err := h.routeViaChannel(ctx, user.ID, text, attachments)
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

// routeViaChannel sends a message through the shared agent ChannelPool and
// collects the streaming response. This uses the same WS protocol as the desktop,
// ensuring conversation context is shared between both channels.
func (h *Handler) routeViaChannel(ctx context.Context, userID, message string, attachments []imageAttachment) (string, error) {
	channel, info, err := h.channelPool.GetOrCreate(ctx, userID, store.ContainerTypeOpenClaw)
	if err != nil {
		return "", fmt.Errorf("get channel: %w", err)
	}
	if info == nil || strings.TrimSpace(info.ContainerToken) == "" {
		return "", fmt.Errorf("openclaw token unavailable")
	}

	// Subscribe to events (lastSeq=0 → no replay required for request/response flow).
	_, updates, unsubscribe := channel.Subscribe(0)
	defer unsubscribe()

	wasConnected := channel.Status().Connected

	// Wait for channel to be connected if not already
	if !wasConnected {
		if !channel.Status().Connected {
			if err := waitForReady(updates); err != nil {
				return "", err
			}
		}
		if err := completeOpenClawHandshake(channel, updates, info.ContainerToken); err != nil {
			return "", err
		}
	}

	// Generate unique request ID for correlation
	requestID := generateRequestID()

	// Build OpenClaw chat.send payload
	actualMessage := message
	if len(attachments) > 0 {
		var sb strings.Builder
		sb.WriteString(message)
		for _, att := range attachments {
			sb.WriteString(fmt.Sprintf("\n[图片: %s]", att.URL))
		}
		actualMessage = sb.String()
	}

	chatReq := map[string]interface{}{
		"type":   "req",
		"id":     requestID,
		"method": "chat.send",
		"params": map[string]interface{}{
			"sessionKey":     defaultSessionKey,
			"message":        actualMessage,
			"idempotencyKey": fmt.Sprintf("feishu-%s-%s", userID, requestID),
		},
	}
	payload, _ := json.Marshal(chatReq)

	// Send the request through the shared channel
	if err := channel.SendRequest("req", payload, requestID); err != nil {
		return "", fmt.Errorf("send chat.send: %w", err)
	}

	// Collect streaming response
	return collectOpenClawResponse(updates, requestID)
}

// waitForReady blocks until the channel emits proxy.ready or times out.
func waitForReady(updates <-chan agent.Event) error {
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

func completeOpenClawHandshake(channel *agent.UserChannel, updates <-chan agent.Event, token string) error {
	timeout := time.After(openClawChallengeWait)

	for {
		select {
		case event, ok := <-updates:
			if !ok {
				return fmt.Errorf("channel closed while waiting for openclaw challenge")
			}
			if event.Event == "proxy.error" {
				return fmt.Errorf("channel error while waiting for openclaw challenge")
			}

			frame, ok := decodeOpenClawFrame(event)
			if !ok {
				continue
			}
			if frame.Type == "event" && frame.Event == "connect.challenge" {
				return sendOpenClawConnect(channel, updates, token)
			}
		case <-timeout:
			// No challenge means the shared channel was already authenticated.
			return nil
		}
	}
}

func sendOpenClawConnect(channel *agent.UserChannel, updates <-chan agent.Event, token string) error {
	connectID := generateRequestID()
	connectReq := map[string]interface{}{
		"type":   "req",
		"id":     connectID,
		"method": "connect",
		"params": map[string]interface{}{
			"minProtocol": 3,
			"maxProtocol": 3,
			"client": map[string]string{
				"id":       "feishu-bot",
				"version":  "1.0.0",
				"platform": "gateway",
				"mode":     "backend",
			},
			"role":   "operator",
			"scopes": []string{"operator.admin"},
			"caps":   []string{"tool-events"},
			"auth": map[string]string{
				"token": token,
			},
		},
	}

	payload, _ := json.Marshal(connectReq)
	if err := channel.SendRequest("req", payload, connectID); err != nil {
		return fmt.Errorf("send openclaw connect: %w", err)
	}

	timeout := time.After(openClawConnectWait)
	for {
		select {
		case event, ok := <-updates:
			if !ok {
				return fmt.Errorf("channel closed during openclaw connect")
			}
			if event.Event == "proxy.error" {
				return fmt.Errorf("channel error during openclaw connect")
			}

			frame, ok := decodeOpenClawFrame(event)
			if !ok || frame.Type != "res" || frame.ID != connectID {
				continue
			}

			if frame.OK != nil && *frame.OK {
				return nil
			}
			errMsg := decodeOpenClawError(frame.Error)
			if errMsg == "" {
				errMsg = "unknown error"
			}
			return fmt.Errorf("openclaw connect rejected: %s", errMsg)
		case <-timeout:
			return fmt.Errorf("openclaw connect timeout (%v)", openClawConnectWait)
		}
	}
}

// collectOpenClawResponse waits for OpenClaw stream events and collects assistant text.
func collectOpenClawResponse(updates <-chan agent.Event, requestID string) (string, error) {
	var response strings.Builder
	timeout := time.After(responseTimeout)

	for {
		select {
		case event, ok := <-updates:
			if !ok {
				if response.Len() > 0 {
					return strings.TrimSpace(response.String()), nil
				}
				return "", fmt.Errorf("channel closed during response collection")
			}
			if event.Event == "proxy.error" {
				if response.Len() > 0 {
					return strings.TrimSpace(response.String()), nil
				}
				return "", fmt.Errorf("channel error while collecting response")
			}

			frame, ok := decodeOpenClawFrame(event)
			if !ok {
				continue
			}

			switch frame.Type {
			case "res":
				if frame.ID != requestID {
					continue
				}
				if frame.OK != nil && *frame.OK {
					continue
				}
				errMsg := decodeOpenClawError(frame.Error)
				if response.Len() > 0 {
					return strings.TrimSpace(response.String()), nil
				}
				if errMsg == "" {
					errMsg = "request failed"
				}
				return "", fmt.Errorf("openclaw request failed: %s", errMsg)

			case "event":
				switch frame.Event {
				case "agent":
					var payload struct {
						Stream string `json:"stream"`
						Data   struct {
							Delta   string `json:"delta"`
							Text    string `json:"text"`
							Phase   string `json:"phase"`
							Error   string `json:"error"`
							Message string `json:"message"`
						} `json:"data"`
					}
					if json.Unmarshal(frame.Payload, &payload) == nil {
						switch payload.Stream {
						case "text", "assistant":
							delta := payload.Data.Delta
							if delta == "" {
								delta = payload.Data.Text
							}
							response.WriteString(delta)
						case "lifecycle":
							if strings.EqualFold(payload.Data.Phase, "error") && response.Len() == 0 {
								errMsg := strings.TrimSpace(payload.Data.Error)
								if errMsg == "" {
									errMsg = strings.TrimSpace(payload.Data.Message)
								}
								if errMsg != "" {
									return "", fmt.Errorf("openclaw stream error: %s", errMsg)
								}
							}
						}
					}

				case "chat":
					var payload struct {
						State        string          `json:"state"`
						ErrorMessage string          `json:"errorMessage"`
						Message      json.RawMessage `json:"message"`
					}
					if json.Unmarshal(frame.Payload, &payload) != nil {
						continue
					}

					state := strings.ToLower(strings.TrimSpace(payload.State))
					switch state {
					case "final", "aborted":
						if response.Len() == 0 {
							response.WriteString(extractOpenClawMessageText(payload.Message))
						}
						return strings.TrimSpace(response.String()), nil
					case "error":
						if response.Len() > 0 {
							return strings.TrimSpace(response.String()), nil
						}
						errMsg := strings.TrimSpace(payload.ErrorMessage)
						if errMsg == "" {
							errMsg = "openclaw chat error"
						}
						return "", fmt.Errorf("%s", errMsg)
					}
				}
			}

		case <-timeout:
			if response.Len() > 0 {
				return strings.TrimSpace(response.String()), nil
			}
			return "", fmt.Errorf("response timeout (%v)", responseTimeout)
		}
	}
}

type openClawFrame struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Event   string          `json:"event,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	OK      *bool           `json:"ok,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

func decodeOpenClawFrame(event agent.Event) (openClawFrame, bool) {
	if event.Event != "message" {
		return openClawFrame{}, false
	}
	var frame openClawFrame
	if err := json.Unmarshal(event.Data, &frame); err != nil || frame.Type == "" {
		return openClawFrame{}, false
	}
	return frame, true
}

func decodeOpenClawError(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var payload struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(raw, &payload) == nil && strings.TrimSpace(payload.Message) != "" {
		return strings.TrimSpace(payload.Message)
	}
	var msg string
	if json.Unmarshal(raw, &msg) == nil {
		return strings.TrimSpace(msg)
	}
	return strings.TrimSpace(string(raw))
}

func extractOpenClawMessageText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var direct string
	if json.Unmarshal(raw, &direct) == nil {
		return strings.TrimSpace(direct)
	}

	var message struct {
		Text    string `json:"text"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(raw, &message) != nil {
		return ""
	}

	if strings.TrimSpace(message.Text) != "" {
		return strings.TrimSpace(message.Text)
	}

	parts := make([]string, 0, len(message.Content))
	for _, item := range message.Content {
		if strings.EqualFold(item.Type, "text") && strings.TrimSpace(item.Text) != "" {
			parts = append(parts, strings.TrimSpace(item.Text))
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n"))
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

// --- Cron announce delivery ---

// CronAnnounceRequest is the payload sent by agent runtimes when a cron job completes.
type CronAnnounceRequest struct {
	JobID         string `json:"jobId"`
	JobName       string `json:"jobName,omitempty"`
	Status        string `json:"status"`
	DurationMs    int64  `json:"durationMs"`
	ResultPreview string `json:"resultPreview,omitempty"`
	Error         string `json:"error,omitempty"`
}

// HandleCronAnnounce receives a cron result and delivers it to the user's Feishu account.
func (h *Handler) HandleCronAnnounce(w http.ResponseWriter, r *http.Request) {
	if !h.client.IsConfigured() {
		writeJSON(w, http.StatusOK, map[string]string{"status": "skipped", "reason": "feishu not configured"})
		return
	}

	var req CronAnnounceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	userInfo := auth.GetUser(r.Context())
	if userInfo == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	ctx := r.Context()
	user, err := h.store.GetUserByID(ctx, userInfo.ID)
	if err != nil || user.FeishuOpenID == nil || *user.FeishuOpenID == "" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "skipped", "reason": "user has no feishu binding"})
		return
	}

	name := req.JobName
	if name == "" {
		name = req.JobID
	}

	var text string
	if req.Status == "ok" {
		text = fmt.Sprintf("⏰ 定时任务 [%s] 完成 (%dms)", name, req.DurationMs)
		if req.ResultPreview != "" {
			preview := req.ResultPreview
			if len(preview) > 500 {
				preview = preview[:500] + "…"
			}
			text += "\n\n" + preview
		}
	} else {
		text = fmt.Sprintf("⏰ 定时任务 [%s] 失败 (%dms)", name, req.DurationMs)
		if req.Error != "" {
			text += "\n错误: " + req.Error
		}
	}

	if err := h.client.SendText(*user.FeishuOpenID, text); err != nil {
		log.Error().Err(err).Str("user_id", userInfo.ID).Str("job_id", req.JobID).Msg("feishu bot: cron announce failed")
		writeJSON(w, http.StatusOK, map[string]string{"status": "error", "reason": err.Error()})
		return
	}

	log.Info().Str("user_id", userInfo.ID).Str("job_id", req.JobID).Str("status", req.Status).Msg("feishu bot: cron announced")
	writeJSON(w, http.StatusOK, map[string]string{"status": "delivered"})
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

func mimeExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	default:
		return ".bin"
	}
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}
