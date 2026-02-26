package feishubot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/lxd"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	maxReplyLength     = 3000
	containerTimeout   = 120 * time.Second
	defaultModel       = "claude-sonnet-4-6"
	systemPrompt       = "你是 JAPilot，京奥电竞的 AI 助手。简洁、专业地回答用户问题。"
	dedupTTL           = 30 * time.Minute
	dedupCleanInterval = 10 * time.Minute
)

var mentionPattern = regexp.MustCompile(`@_user_\d+\s*`)

// Handler processes Feishu webhook events and routes messages to OpenClaw containers.
type Handler struct {
	client       *Client
	store        *store.Store
	lxdClient    *lxd.SSHClient
	freezer      *lxd.Freezer
	openclawPort int

	processedEvents sync.Map // event_id → time.Time
}

func NewHandler(client *Client, s *store.Store, lxdClient *lxd.SSHClient, freezer *lxd.Freezer, openclawPort int) *Handler {
	h := &Handler{
		client:       client,
		store:        s,
		lxdClient:    lxdClient,
		freezer:      freezer,
		openclawPort: openclawPort,
	}
	go h.cleanupLoop()
	return h
}

// --- Feishu event structures ---

type feishuEvent struct {
	Schema string       `json:"schema"`
	Header feishuHeader `json:"header"`
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

	// Get container info
	info, err := h.store.GetContainerInfo(ctx, user.ID)
	if err != nil {
		log.Warn().Str("user_id", user.ID).Msg("feishu bot: no container")
		h.client.ReplyText(messageID, "您的 AI 容器尚未创建。请先在桌面端进入 OpenClaw 模式完成初始化。")
		return
	}

	// Ensure container is running
	if err := h.ensureRunning(ctx, info, user.ID); err != nil {
		log.Error().Err(err).Str("container", info.ContainerName).Msg("feishu bot: container unavailable")
		h.client.ReplyText(messageID, "AI 容器暂时不可用，请稍后重试。")
		return
	}

	// Route message to container
	response, err := h.routeToContainer(info, text)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("feishu bot: route to container failed")
		h.client.ReplyText(messageID, "AI 处理消息时出错，请稍后重试。")
		return
	}

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

// --- Container routing ---

func (h *Handler) routeToContainer(info *store.ContainerInfo, message string) (string, error) {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model": defaultModel,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": message},
		},
		"stream": false,
	})

	url := fmt.Sprintf("http://%s:%d/v1/chat/completions", info.ContainerIP, h.openclawPort)
	req, _ := http.NewRequest("POST", url, bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+info.ContainerToken)

	client := &http.Client{Timeout: containerTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request container: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("container returned %d: %s", resp.StatusCode, string(respBody))
	}

	var chatResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("empty response from container")
	}

	return strings.TrimSpace(chatResp.Choices[0].Message.Content), nil
}

func (h *Handler) ensureRunning(ctx context.Context, info *store.ContainerInfo, userID string) error {
	if h.lxdClient == nil {
		return nil
	}

	status, err := h.lxdClient.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	if h.freezer != nil {
		h.freezer.Touch(info.ContainerName)
	}

	switch strings.ToUpper(status.Status) {
	case "RUNNING":
		return nil
	case "FROZEN":
		log.Info().Str("container", info.ContainerName).Msg("feishu bot: unfreezing container")
		if err := h.lxdClient.Unfreeze(info.ContainerName); err != nil {
			return err
		}
		return h.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running")
	case "STOPPED":
		log.Info().Str("container", info.ContainerName).Msg("feishu bot: starting container")
		if err := h.lxdClient.Start(info.ContainerName); err != nil {
			return err
		}
		ip, err := h.lxdClient.GetIP(info.ContainerName)
		if err != nil {
			return err
		}
		info.ContainerIP = ip
		return h.store.UpdateContainerIP(ctx, userID, ip)
	default:
		return fmt.Errorf("container in unexpected state: %s", status.Status)
	}
}

// --- Helpers ---

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

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}
