package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	dockerpkg "github.com/fran0220/jacoworks/gateway/internal/docker"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const ContainerMountPath = "/home/agent/cowork"

type Handler struct {
	store          *store.Store
	dockerClient   *dockerpkg.Client
	freezer        *dockerpkg.Freezer
	agentPort      int
	chatAgentURL   string
	chatAgentToken string
	containerEnvVars map[string]string
}

func NewHandler(s *store.Store, dockerClient *dockerpkg.Client, freezer *dockerpkg.Freezer, agentPort int, chatAgentURL, chatAgentToken string) *Handler {
	return &Handler{
		store:          s,
		dockerClient:   dockerClient,
		freezer:        freezer,
		agentPort:      agentPort,
		chatAgentURL:   chatAgentURL,
		chatAgentToken: chatAgentToken,
	}
}

// SetContainerEnvVars sets env vars used when reprovisioning destroyed containers.
func (h *Handler) SetContainerEnvVars(envVars map[string]string) {
	h.containerEnvVars = envVars
}

func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	// Route: X-Cowork-Session header → per-user container, otherwise → shared agent
	if sid := r.Header.Get("X-Cowork-Session"); sid != "" {
		sess, err := h.store.GetSession(r.Context(), user.ID, sid)
		if err == nil && sess.Type == "cowork" {
			h.proxyToContainer(w, r, user, sid)
			return
		}
	}

	// Default: chat mode → shared agent
	h.proxyToSharedAgent(w, r, user)
}

// proxyToSharedAgent forwards the request to the shared vm-agent on the host.
func (h *Handler) proxyToSharedAgent(w http.ResponseWriter, r *http.Request, user *auth.UserInfo) {
	if h.chatAgentURL == "" {
		http.Error(w, `{"error":"chat agent not configured"}`, http.StatusServiceUnavailable)
		return
	}

	target, err := url.Parse(h.chatAgentURL)
	if err != nil {
		http.Error(w, `{"error":"invalid chat agent URL"}`, http.StatusInternalServerError)
		return
	}

	token := h.chatAgentToken

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			if token != "" {
				req.Header.Set("Authorization", "Bearer "+token)
			}
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Error().Err(err).
				Str("target", target.Host).
				Str("user_id", user.ID).
				Msg("shared agent proxy error")
			http.Error(w, `{"error":"chat agent unavailable"}`, http.StatusBadGateway)
		},
	}

	log.Info().
		Str("user_id", user.ID).
		Str("target", target.Host).
		Msg("proxying chat to shared agent")

	proxy.ServeHTTP(w, r)
}

// proxyToContainer forwards the request to the user's per-container vm-agent.
func (h *Handler) proxyToContainer(w http.ResponseWriter, r *http.Request, user *auth.UserInfo, coworkSessionID string) {
	info, err := h.store.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeVMAgent)
	if err != nil {
		log.Error().Err(err).Str("user_id", user.ID).Msg("get container info failed")
		http.Error(w, `{"error":"no container provisioned, enter cowork mode first"}`, http.StatusBadGateway)
		return
	}

	if h.freezer != nil {
		h.freezer.Touch(info.ContainerName)
	}

	if err := h.ensureRunning(r.Context(), info.ContainerName, user.ID); err != nil {
		log.Error().Err(err).Str("container", info.ContainerName).Msg("wake container failed")
		http.Error(w, `{"error":"container unavailable, try again"}`, http.StatusServiceUnavailable)
		return
	}

	// Inject cowork context into system prompt
	injectCoworkContext(r, ContainerMountPath)

	target := &url.URL{
		Scheme: "http",
		Host:   fmt.Sprintf("%s:%d", info.ContainerIP, h.agentPort),
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			req.Header.Set("Authorization", "Bearer "+info.ContainerToken)
		},
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Error().Err(err).
				Str("target", target.Host).
				Str("user_id", user.ID).
				Msg("container proxy error")
			http.Error(w, `{"error":"upstream unavailable"}`, http.StatusBadGateway)
		},
	}

	log.Info().
		Str("user_id", user.ID).
		Str("container", info.ContainerName).
		Str("target", target.Host).
		Msg("proxying cowork to container")

	proxy.ServeHTTP(w, r)
}

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

func (h *Handler) ensureRunning(ctx context.Context, containerName, userID string) error {
	if h.dockerClient == nil {
		return nil
	}

	info, err := h.dockerClient.Status(containerName)
	if err != nil {
		return fmt.Errorf("check status: %w", err)
	}

	switch strings.ToLower(info.Status) {
	case "running":
		return nil
	case "paused":
		log.Info().Str("container", containerName).Str("user_id", userID).Msg("unpausing container")
		if err := h.dockerClient.Unfreeze(containerName); err != nil {
			return err
		}
		return h.store.UpdateContainerStatusByName(ctx, containerName, "running")
	case "exited":
		log.Info().Str("container", containerName).Str("user_id", userID).Msg("starting stopped container")
		if err := h.dockerClient.Start(containerName); err != nil {
			return err
		}
		ip, err := h.dockerClient.GetIP(containerName)
		if err != nil {
			return err
		}
		return h.store.UpdateContainerIP(ctx, userID, store.ContainerTypeVMAgent, ip)
	case "not_found":
		if h.containerEnvVars == nil {
			return fmt.Errorf("container destroyed and no env vars for reprovision")
		}
		cInfo, err := h.store.GetContainerInfo(ctx, userID, store.ContainerTypeVMAgent)
		if err != nil {
			return fmt.Errorf("get container info for reprovision: %w", err)
		}
		log.Info().Str("container", containerName).Str("user_id", userID).Msg("container not found, reprovisioning")
		ip, err := h.dockerClient.ProvisionContainer(containerName, cInfo.ContainerToken, h.containerEnvVars, cInfo.HostPort)
		if err != nil {
			return fmt.Errorf("reprovision: %w", err)
		}
		return h.store.UpdateContainerIP(ctx, userID, store.ContainerTypeVMAgent, ip)
	default:
		return fmt.Errorf("container in unexpected state: %s", info.Status)
	}
}
