package proxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/lxd"
	"github.com/fran0220/jacoworks/gateway/internal/user"
)

const ContainerMountPath = "/home/agent/cowork"

type Handler struct {
	store        *user.Store
	lxdClient    *lxd.SSHClient
	freezer      *lxd.Freezer
	openclawPort int
}

func NewHandler(store *user.Store, lxdClient *lxd.SSHClient, freezer *lxd.Freezer, openclawPort int) *Handler {
	return &Handler{
		store:        store,
		lxdClient:    lxdClient,
		freezer:      freezer,
		openclawPort: openclawPort,
	}
}

func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetUser(r.Context())
	if claims == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	info, err := h.store.GetContainerInfo(claims.UserID)
	if err != nil {
		log.Error().Err(err).Int64("user_id", claims.UserID).Msg("get container info failed")
		http.Error(w, `{"error":"container not found"}`, http.StatusBadGateway)
		return
	}

	// Mark as active (prevents idle freeze)
	if h.freezer != nil {
		h.freezer.Touch(info.ContainerName)
	}

	// Wake container if frozen/stopped
	if err := h.ensureRunning(info.ContainerName, claims.UserID); err != nil {
		log.Error().Err(err).Str("container", info.ContainerName).Msg("wake container failed")
		http.Error(w, `{"error":"container unavailable, try again"}`, http.StatusServiceUnavailable)
		return
	}

	// Inject cowork context if applicable
	if sid := r.Header.Get("X-Cowork-Session"); sid != "" {
		sess, err := h.store.GetSession(claims.UserID, sid)
		if err == nil && sess.Type == "cowork" {
			injectCoworkContext(r, ContainerMountPath)
		}
	}

	target := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%d", info.ContainerIP, h.openclawPort),
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			req.Header.Set("Authorization", "Bearer "+info.ContainerToken)
		},
		FlushInterval: -1, // SSE real-time streaming
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Error().Err(err).
				Str("target", target.Host).
				Int64("user_id", claims.UserID).
				Msg("proxy error")
			http.Error(w, `{"error":"upstream unavailable"}`, http.StatusBadGateway)
		},
	}

	log.Info().
		Int64("user_id", claims.UserID).
		Str("container", info.ContainerName).
		Str("target", target.Host).
		Msg("proxying chat request")

	proxy.ServeHTTP(w, r)
}

// injectCoworkContext prepends a cowork prompt to the first system message.
func injectCoworkContext(r *http.Request, workspacePath string) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		return
	}
	r.Body.Close()

	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		return
	}

	messages, ok := body["messages"].([]interface{})
	if !ok || len(messages) == 0 {
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		return
	}

	coworkPrompt := fmt.Sprintf(
		"\n\n[Cowork 模式] 用户的文件已挂载到 %s 目录。请在此目录下操作文件。完成后告诉用户你修改了哪些文件。",
		workspacePath,
	)

	if first, ok := messages[0].(map[string]interface{}); ok {
		if role, _ := first["role"].(string); role == "system" {
			if content, ok := first["content"].(string); ok {
				first["content"] = content + coworkPrompt
			}
		}
	}

	newBody, _ := json.Marshal(body)
	r.Body = io.NopCloser(bytes.NewReader(newBody))
	r.ContentLength = int64(len(newBody))
}

// ensureRunning checks container status and wakes it if frozen/stopped.
func (h *Handler) ensureRunning(containerName string, userID int64) error {
	if h.lxdClient == nil {
		return nil // No LXD client (dev mode)
	}

	status, err := h.lxdClient.Status(containerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	switch strings.ToUpper(status.Status) {
	case "RUNNING":
		return nil
	case "FROZEN":
		log.Info().Str("container", containerName).Int64("user_id", userID).Msg("unfreezing container")
		return h.lxdClient.Unfreeze(containerName)
	case "STOPPED":
		log.Info().Str("container", containerName).Int64("user_id", userID).Msg("starting stopped container")
		if err := h.lxdClient.Start(containerName); err != nil {
			return err
		}
		// Update IP after start
		ip, err := h.lxdClient.GetIP(containerName)
		if err != nil {
			return err
		}
		return h.store.UpdateContainerIP(userID, ip)
	default:
		return fmt.Errorf("container in unexpected state: %s", status.Status)
	}
}
