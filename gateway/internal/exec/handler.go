package execws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	dockerpkg "github.com/fran0220/jacoworks/gateway/internal/docker"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	defaultExecTimeout = 30 * time.Second
	maxExecTimeout     = 120 * time.Second
)

var execWSUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS is handled by outer middleware.
	},
	ReadBufferSize:  16 * 1024,
	WriteBufferSize: 16 * 1024,
}

type Handler struct {
	store        *store.Store
	dockerClient *dockerpkg.Client
	freezer      *dockerpkg.Freezer
}

type execRunRequest struct {
	Type      string `json:"type"`
	ReqID     string `json:"req_id"`
	Command   string `json:"command"`
	TimeoutMS int64  `json:"timeout_ms"`
	CWD       string `json:"cwd,omitempty"`
}

type execResultResponse struct {
	Type     string `json:"type"`
	ReqID    string `json:"req_id"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode *int   `json:"exit_code"`
	Killed   bool   `json:"killed"`
	Error    string `json:"error,omitempty"`
}

func NewHandler(s *store.Store, dockerClient *dockerpkg.Client, freezer *dockerpkg.Freezer) *Handler {
	return &Handler{
		store:        s,
		dockerClient: dockerClient,
		freezer:      freezer,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	conn, err := execWSUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("exec ws: upgrade failed")
		return
	}
	defer conn.Close()

	log.Info().Str("user_id", user.ID).Msg("exec ws: connected")

	for {
		msgType, payload, err := conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Debug().Err(err).Str("user_id", user.ID).Msg("exec ws: read failed")
			}
			return
		}

		if msgType != websocket.TextMessage {
			continue
		}

		var req execRunRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			h.writeResult(conn, &execResultResponse{
				Type:  "exec.result",
				Error: "invalid request payload",
			})
			continue
		}

		resp := h.handleExecRequest(r.Context(), user.ID, &req)
		if err := h.writeResult(conn, resp); err != nil {
			log.Debug().Err(err).Str("user_id", user.ID).Msg("exec ws: write failed")
			return
		}
	}
}

func (h *Handler) handleExecRequest(ctx context.Context, userID string, req *execRunRequest) *execResultResponse {
	resp := &execResultResponse{
		Type:  "exec.result",
		ReqID: req.ReqID,
	}

	if req.Type != "exec.run" {
		resp.Error = "unsupported message type"
		return resp
	}

	if strings.TrimSpace(req.ReqID) == "" {
		resp.Error = "req_id is required"
		return resp
	}

	if strings.TrimSpace(req.Command) == "" {
		resp.Error = "command is required"
		return resp
	}

	if h.store == nil || h.dockerClient == nil {
		resp.Error = "exec backend not configured"
		return resp
	}

	info, err := h.store.GetContainerInfo(ctx, userID, store.ContainerTypeVMAgent)
	if err != nil {
		resp.Error = "vm-agent container not found, provision container first"
		return resp
	}

	if h.freezer != nil {
		h.freezer.Touch(info.ContainerName)
	}

	if err := h.ensureContainerReady(ctx, info, userID); err != nil {
		resp.Error = err.Error()
		return resp
	}

	timeout := normalizedTimeout(req.TimeoutMS)
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	result, runErr := h.dockerClient.ExecCommand(execCtx, info.ContainerName, req.Command, req.CWD)
	if result != nil {
		resp.Stdout = result.Stdout
		resp.Stderr = result.Stderr
		resp.ExitCode = result.ExitCode
		resp.Killed = result.Killed
	}
	if runErr != nil {
		resp.Error = runErr.Error()
	}

	if execCtx.Err() == context.DeadlineExceeded {
		resp.Killed = true
	}

	return resp
}

func (h *Handler) ensureContainerReady(ctx context.Context, info *store.ContainerInfo, userID string) error {
	status, err := h.dockerClient.Status(info.ContainerName)
	if err != nil {
		return fmt.Errorf("check container status: %w", err)
	}

	switch strings.ToLower(status.Status) {
	case "running":
		return nil
	case "paused":
		log.Info().Str("user_id", userID).Str("container", info.ContainerName).Msg("exec ws: unpausing container")
		if err := h.dockerClient.Unpause(info.ContainerName); err != nil {
			return fmt.Errorf("unpause container: %w", err)
		}
		if err := h.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			log.Warn().Err(err).Str("container", info.ContainerName).Msg("exec ws: update status after unpause failed")
		}
		return nil
	case "stopped", "exited":
		log.Info().Str("user_id", userID).Str("container", info.ContainerName).Msg("exec ws: starting stopped container")
		if err := h.dockerClient.Start(info.ContainerName); err != nil {
			return fmt.Errorf("start container: %w", err)
		}
		if err := h.store.UpdateContainerStatusByName(ctx, info.ContainerName, "running"); err != nil {
			log.Warn().Err(err).Str("container", info.ContainerName).Msg("exec ws: update status after start failed")
		}
		return nil
	case "not_found":
		return fmt.Errorf("vm-agent container not found, provision container first")
	default:
		return fmt.Errorf("container in unexpected state: %s", status.Status)
	}
}

func (h *Handler) writeResult(conn *websocket.Conn, resp *execResultResponse) error {
	return conn.WriteJSON(resp)
}

func normalizedTimeout(timeoutMS int64) time.Duration {
	if timeoutMS <= 0 {
		return defaultExecTimeout
	}

	timeout := time.Duration(timeoutMS) * time.Millisecond
	if timeout > maxExecTimeout {
		return maxExecTimeout
	}
	return timeout
}
