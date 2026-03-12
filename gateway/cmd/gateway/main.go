package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/markbates/goth"
	posthog "github.com/posthog/posthog-go"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/agent"
	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/auth/feishu"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	dockerpkg "github.com/fran0220/jacoworks/gateway/internal/docker"
	execws "github.com/fran0220/jacoworks/gateway/internal/exec"
	"github.com/fran0220/jacoworks/gateway/internal/feishubot"
	"github.com/fran0220/jacoworks/gateway/internal/games"
	"github.com/fran0220/jacoworks/gateway/internal/github"
	"github.com/fran0220/jacoworks/gateway/internal/middleware"
	"github.com/fran0220/jacoworks/gateway/internal/proxy"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

func main() {
	configPath := "gateway.yaml"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	var logWriter zerolog.LevelWriter
	if isTerminal() {
		logWriter = zerolog.MultiLevelWriter(
			zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339},
		)
	} else {
		logWriter = zerolog.MultiLevelWriter(os.Stderr)
	}
	log.Logger = zerolog.New(logWriter).With().Timestamp().Caller().Logger()

	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatal().Err(err).Msg("load config")
	}
	log.Info().Str("addr", cfg.Addr()).Msg("config loaded")

	// Initialize PostgreSQL
	ctx := context.Background()
	s, err := store.New(ctx, cfg.Database.URL)
	if err != nil {
		log.Fatal().Err(err).Msg("init database")
	}
	defer s.Close()

	// Load settings from DB (overrides YAML values)
	if dbSettings, err := s.GetAllSettings(ctx); err == nil {
		llm := cfg.GetLLM()
		for _, setting := range dbSettings {
			if setting.Value == "" {
				continue
			}
			switch setting.Key {
			case "llm_proxy_url":
				llm.ProxyURL = setting.Value
			case "llm_proxy_key":
				llm.ProxyKey = setting.Value
			case "openai_api_key":
				llm.OpenAIAPIKey = setting.Value
			case "exa_api_key":
				llm.ExaAPIKey = setting.Value
			case "tavily_api_key":
				llm.TavilyKey = setting.Value
			case "embedding_base_url":
				llm.EmbeddingBaseURL = setting.Value
			case "embedding_api_key":
				llm.EmbeddingAPIKey = setting.Value
			case "fal_api_key":
				llm.FalAPIKey = setting.Value
			case "jimeng_api_url":
				llm.JimengAPIURL = setting.Value
			case "jimeng_api_key":
				llm.JimengAPIKey = setting.Value
			case "primary_model":
				llm.PrimaryModel = setting.Value
			case "primary_provider":
				llm.PrimaryProvider = setting.Value
			case "feishu_client_id":
				cfg.Auth.FeishuClientID = setting.Value
			case "feishu_client_secret":
				cfg.Auth.FeishuClientSecret = setting.Value
			case "admin_token":
				cfg.Auth.AdminToken = setting.Value
			case "github_token":
				cfg.GitHub.Token = setting.Value
			case "github_repo":
				cfg.GitHub.Repo = setting.Value
			case "posthog_api_key":
				cfg.PostHog.APIKey = setting.Value
			case "posthog_endpoint":
				cfg.PostHog.Endpoint = setting.Value
			}
		}
		cfg.UpdateLLM(llm)
		log.Info().Msg("loaded settings from database")
	}

	auditLogger := audit.NewLogger(s.Pool())

	// Initialize PostHog client (error tracking + analytics, hot-reloadable via admin settings)
	ph := &postHogHolder{}
	ph.Reload(cfg.PostHog.APIKey, cfg.PostHog.Endpoint)
	ph.CaptureEvent("gateway-server", "gateway_started", map[string]interface{}{
		"addr": cfg.Addr(),
	})

	// Initialize Docker client
	dockerClient := dockerpkg.NewClient(
		cfg.Docker.DockerHost,
		cfg.Docker.Image,
		cfg.Docker.Network,
		cfg.Docker.AgentPort,
		cfg.Docker.HostIP,
	)

	// vm-agent containers run persistently (no idle freeze/stop).
	// OpenClaw containers use a separate freezer below.

	// OpenClaw Docker client + freezer (separate host, "oc-" prefix)
	var ocClient *dockerpkg.OpenClawClient
	var ocFreezer *dockerpkg.Freezer
	if cfg.OpenClaw.DockerHost != "" {
		ocDockerClient := dockerpkg.NewClient(
			cfg.OpenClaw.DockerHost,
			cfg.OpenClaw.Image,
			"",
			cfg.OpenClaw.Port,
			cfg.OpenClaw.HostIP,
		)
		ocClient = dockerpkg.NewOpenClawClient(ocDockerClient, cfg.OpenClaw.DataRoot, cfg.GetLLM, s)
		ocFreezer = dockerpkg.NewFreezerWithPrefix(ocDockerClient, "oc-", 30*time.Minute, 2*time.Hour, 5*time.Minute)
		ocFreezer.Start()
		defer ocFreezer.Stop()
		ocFreezer.SetOnAfterFreeze(func(containerName string) {
			if err := s.UpdateContainerStatusByName(context.Background(), containerName, "stopped"); err != nil {
				log.Error().Err(err).Str("container", containerName).Msg("openclaw idle stop: update status failed")
			}
		})
		log.Info().Str("docker_host", cfg.OpenClaw.DockerHost).Str("image", cfg.OpenClaw.Image).Msg("openclaw backend initialized")
	}

	// Initialize Goth providers
	if cfg.Auth.FeishuClientID != "" {
		baseURL := cfg.Server.PublicURL
		if baseURL == "" {
			baseURL = fmt.Sprintf("http://%s", cfg.Addr())
		}
		callbackURL := baseURL + "/api/auth/feishu/callback"
		goth.UseProviders(feishu.New(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret, callbackURL))
		log.Info().Str("callback", callbackURL).Msg("feishu SSO provider registered")
	}

	// Initialize handlers
	authMiddleware := auth.NewMiddleware(s, cfg.Auth.AdminToken)
	authHandlers := auth.NewHandlers(s, cfg.Auth.SessionTTLHours)
	proxyHandler := proxy.NewHandler(s, dockerClient, nil, cfg.Docker.AgentPort, cfg.ChatAgent.URL, cfg.ChatAgent.Token)
	backendAdapter := dockerpkg.NewBackendAdapter(dockerClient)
	execHandler := execws.NewHandler(s, dockerClient, nil)

	// Inject container env vars for auto-reprovision of destroyed containers
	envVars := containerEnvVars(cfg)
	proxyHandler.SetContainerEnvVars(envVars)

	// Build UpstreamDialer map for unified channel architecture
	vmDialer := agent.NewVMAgentDialer(s, backendAdapter, cfg.Docker.AgentPort, cfg.Docker.HostIP, cfg.Docker.GatewayToken)
	vmDialer.SetContainerEnvVars(envVars)

	dialers := map[string]agent.UpstreamDialer{
		store.ContainerTypeVMAgent: vmDialer,
	}

	if ocClient != nil {
		ocDialer := agent.NewOpenClawDialer(s, ocClient, ocFreezer)
		ocDialer.SetAutoPairEnabled(true)
		dialers[store.ContainerTypeOpenClaw] = ocDialer
	}

	channelPool := agent.NewChannelPool(s, dialers, 5*time.Minute, 1024)
	defer channelPool.Close()
	wsTicketStore := agent.NewTicketStore(30 * time.Second)
	defer wsTicketStore.Close()
	wsHandler := agent.NewWSHandler(channelPool, wsTicketStore, func(userID, event string, properties map[string]interface{}) {
		ph.CaptureEvent(userID, event, properties)
	})
	sseHandler := agent.NewSSEHandler(channelPool)

	// Initialize Feishu Bot handler (shares ChannelPool with desktop for conversation sync)
	feishuBotClient := feishubot.NewClient(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret)
	feishuBotHandler := feishubot.NewHandler(feishuBotClient, s, channelPool)
	gamesHandler := games.NewHandler(s)
	ghClient := github.NewClient(cfg.GitHub.Token, cfg.GitHub.Repo)

	mux := http.NewServeMux()

	// Feishu webhook (no auth — Feishu platform calls this)
	mux.HandleFunc("POST /api/feishu/webhook", feishuBotHandler.HandleWebhook)

	// Auth endpoints (no auth required)
	mux.HandleFunc("POST /api/auth/login", authHandlers.Login)
	mux.HandleFunc("POST /api/auth/activate", authHandlers.Activate)
	mux.HandleFunc("GET /api/auth/feishu", authHandlers.FeishuBegin)
	mux.HandleFunc("GET /api/auth/feishu/callback", authHandlers.FeishuCallback)

	// Auth endpoints (auth required)
	mux.Handle("POST /api/auth/logout", authMiddleware.Authenticate(http.HandlerFunc(authHandlers.Logout)))

	// Authenticated: user info
	mux.Handle("GET /api/users/me", authMiddleware.Authenticate(http.HandlerFunc(meHandler)))

	// Authenticated: sessions
	mux.Handle("GET /api/sessions", authMiddleware.Authenticate(http.HandlerFunc(listSessionsHandler(s))))
	mux.Handle("POST /api/sessions", authMiddleware.Authenticate(http.HandlerFunc(createSessionHandler(s, dockerClient))))
	mux.Handle("GET /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(getSessionHandler(s))))
	mux.Handle("PUT /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(updateSessionHandler(s))))
	mux.Handle("DELETE /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(deleteSessionHandler(s))))

	// Authenticated: agent config
	mux.Handle("GET /api/agent/config", authMiddleware.Authenticate(http.HandlerFunc(agentConfigHandler(cfg))))

	// Authenticated: memory sync & management
	mux.Handle("POST /api/memory/sync", authMiddleware.Authenticate(http.HandlerFunc(memorySyncHandler(s))))
	mux.Handle("GET /api/memory/stats", authMiddleware.Authenticate(http.HandlerFunc(memoryStatsHandler(s))))
	mux.Handle("DELETE /api/memory", authMiddleware.Authenticate(http.HandlerFunc(memoryClearHandler(s))))

	// Authenticated: skills sync (legacy — retained for push-skills.sh)
	mux.Handle("POST /api/skills/upload", authMiddleware.Authenticate(http.HandlerFunc(skillsUploadHandler(s))))
	mux.Handle("GET /api/skills/checksum", authMiddleware.Authenticate(http.HandlerFunc(skillsChecksumHandler(s))))
	mux.Handle("GET /api/skills/pull", authMiddleware.Authenticate(http.HandlerFunc(skillsPullHandler(s))))

	// Authenticated: skills CRUD (desktop → gateway DB → container hot-push)
	mux.Handle("GET /api/skills", authMiddleware.Authenticate(http.HandlerFunc(skillsListHandler(s))))
	mux.Handle("PUT /api/skills/{skillId}", authMiddleware.Authenticate(http.HandlerFunc(skillsUpsertHandler(s, dockerClient))))
	mux.Handle("DELETE /api/skills/{skillId}", authMiddleware.Authenticate(http.HandlerFunc(skillsDeleteHandler(s, dockerClient))))

	// Authenticated: cowork
	mux.Handle("GET /api/cowork/container-status", authMiddleware.Authenticate(http.HandlerFunc(containerStatusHandler(s))))
	mux.Handle("POST /api/cowork/provision", authMiddleware.Authenticate(http.HandlerFunc(selfProvisionHandler(s, dockerClient, ocClient, auditLogger, cfg))))

	// Authenticated: cron announce (vm-agent → feishu delivery)
	mux.Handle("POST /api/cron/announce", authMiddleware.Authenticate(http.HandlerFunc(feishuBotHandler.HandleCronAnnounce)))

	// Authenticated: cron job CRUD (sidecar proxy target)
	mux.Handle("POST /api/cron/jobs", authMiddleware.Authenticate(http.HandlerFunc(createCronJobHandler(s))))
	mux.Handle("GET /api/cron/jobs", authMiddleware.Authenticate(http.HandlerFunc(listCronJobsHandler(s))))
	mux.Handle("DELETE /api/cron/jobs/{id}", authMiddleware.Authenticate(http.HandlerFunc(deleteCronJobHandler(s))))
	mux.Handle("POST /api/cron/jobs/{id}/run", authMiddleware.Authenticate(http.HandlerFunc(runCronJobHandler())))
	mux.Handle("GET /api/cron/jobs/{id}/history", authMiddleware.Authenticate(http.HandlerFunc(cronJobHistoryHandler())))

	// Games (list is public, deploy/delete require auth)
	mux.HandleFunc("GET /api/games", gamesHandler.List)
	mux.Handle("POST /api/games/deploy", authMiddleware.Authenticate(http.HandlerFunc(gamesHandler.Deploy)))
	mux.Handle("DELETE /api/games/{id}", authMiddleware.Authenticate(http.HandlerFunc(gamesHandler.Delete)))
	mux.Handle("POST /api/feedback", authMiddleware.Authenticate(http.HandlerFunc(feedbackHandler(s, ghClient))))

	// Authenticated: chat proxy
	mux.Handle("POST /v1/chat/completions", authMiddleware.Authenticate(http.HandlerFunc(proxyHandler.ChatCompletions)))

	mux.Handle("GET /ws/exec", authMiddleware.Authenticate(execHandler))

	// Desktop ticket endpoint (same ticket store as webchat)
	mux.Handle("POST /api/agent/ws-ticket", authMiddleware.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsTicketStore.IssueTicket(w, r)
		if user := auth.GetUser(r.Context()); user != nil {
			ph.CaptureEvent(user.ID, "ws_ticket_issued", map[string]interface{}{
				"user_name": user.Name,
				"source":    "desktop",
			})
		}
	})))

	// Agent browser WebSocket bridge (ticket auth — unified for desktop + webchat)
	mux.Handle("POST /api/oc/ws-ticket", authMiddleware.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsTicketStore.IssueTicket(w, r)
		if user := auth.GetUser(r.Context()); user != nil {
			ph.CaptureEvent(user.ID, "ws_ticket_issued", map[string]interface{}{
				"user_name": user.Name,
			})
		}
	})))
	mux.Handle("GET /ws/oc", wsHandler)

	// Agent SSE/HTTP bridge
	mux.Handle("GET /api/oc/stream", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.StreamEvents)))
	mux.Handle("POST /api/oc/send", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.SendCommand)))
	mux.Handle("GET /api/oc/status", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.GetStatus)))

	// User: available teams (templates)
	mux.Handle("GET /api/teams", authMiddleware.Authenticate(http.HandlerFunc(userTeamsHandler(s, ocClient))))
	mux.Handle("POST /api/teams/install", authMiddleware.Authenticate(http.HandlerFunc(installUserTeamHandler(s, ocClient, auditLogger))))

	// User: JaMOSS read proxy (OpenClaw middleware)
	jamossProxy := authMiddleware.Authenticate(http.HandlerFunc(jamossProxyHandler(s, ocClient)))
	mux.Handle("GET /api/jamoss", jamossProxy)
	mux.Handle("GET /api/jamoss/", jamossProxy)
	mux.Handle("POST /api/jamoss", jamossProxy)
	mux.Handle("POST /api/jamoss/", jamossProxy)
	mux.Handle("PUT /api/jamoss", jamossProxy)
	mux.Handle("PUT /api/jamoss/", jamossProxy)
	mux.Handle("DELETE /api/jamoss", jamossProxy)
	mux.Handle("DELETE /api/jamoss/", jamossProxy)
	mux.Handle("PATCH /api/jamoss", jamossProxy)
	mux.Handle("PATCH /api/jamoss/", jamossProxy)

	// Admin: container management
	mux.Handle("GET /api/admin/containers", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listContainersHandler(dockerClient)))))
	mux.Handle("GET /api/admin/templates", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listTemplatesHandler(ocClient)))))
	mux.Handle("POST /api/admin/containers/{id}/start", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(startContainerHandler(dockerClient, s, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/stop", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(stopContainerHandler(dockerClient, s, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/sync-config", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(syncContainerConfigHandler(s, ocClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/install-template", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(installTemplateHandler(s, ocClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/restart", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(restartContainerHandler(dockerClient, ocClient, s, auditLogger)))))

	// Admin: user management (container provisioning after activation)
	mux.Handle("POST /api/admin/provision", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(provisionContainerHandler(s, dockerClient, auditLogger, cfg)))))

	// Admin: invite codes
	mux.Handle("POST /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(createInviteCodeHandler(s)))))
	mux.Handle("GET /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listInviteCodesHandler(s)))))

	// Admin: settings
	mux.Handle("GET /api/admin/settings", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(getSettingsHandler(s)))))
	mux.Handle("PUT /api/admin/settings", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(updateSettingsHandler(s, cfg, auditLogger, feishuBotClient, ghClient, ph)))))

	// Admin: logs
	mux.Handle("GET /api/admin/logs", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(adminLogsHandler(dockerClient)))))

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	// Middleware chain: PanicRecovery → RequestID → RequestLog → CORS → mux
	onError := func(event string, properties map[string]interface{}) {
		ph.CaptureEvent("gateway-server", event, properties)
	}
	handler := middleware.PanicRecoveryWithCallback(
		middleware.RequestID(
			middleware.RequestLogWithCallback(
				corsMiddleware(mux),
				onError,
			),
		),
		onError,
	)

	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 30 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		log.Info().Str("signal", sig.String()).Msg("shutting down")
		server.Close()
	}()

	log.Info().Str("addr", cfg.Addr()).Msg("starting gateway")
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("server error")
	}
	ph.Close()
}

// --- CORS ---

var allowedOrigins = map[string]bool{
	"http://localhost:1420":    true,
	"tauri://localhost":        true, // macOS WebKit
	"https://tauri.localhost":  true, // Windows WebView2
	"https://jaco.jingao.club": true,
}

func isAllowedOrigin(origin string) bool {
	if allowedOrigins[origin] {
		return true
	}

	u, err := url.Parse(origin)
	if err != nil {
		return false
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}

	host := strings.ToLower(u.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Cowork-Session, Upgrade")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func meHandler(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":    user.ID,
		"name":  user.Name,
		"email": user.Email,
		"role":  user.Role,
	})
}

func listContainersHandler(client *dockerpkg.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		containers, err := client.List()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, containers)
	}
}

func listTemplatesHandler(ocClient *dockerpkg.OpenClawClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		templates, err := ocClient.ListTemplates()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if templates == nil {
			templates = []dockerpkg.TemplateSummary{}
		}
		writeJSON(w, http.StatusOK, templates)
	}
}

// userTeamsHandler returns the templates available to the current user.
// Unlike the admin endpoint, this includes the current installed template and active leader session key.
func userTeamsHandler(s *store.Store, ocClient *dockerpkg.OpenClawClient) http.HandlerFunc {
	type response struct {
		Installed        string                      `json:"installed"`
		ActiveSessionKey string                      `json:"activeSessionKey"`
		Available        []dockerpkg.TemplateSummary `json:"available"`
	}

	leaderSessionKey := func(tmpl *dockerpkg.TemplateSummary) string {
		if tmpl == nil {
			return ""
		}
		for _, agent := range tmpl.Agents {
			if agent.IsLeader && strings.TrimSpace(agent.ID) != "" {
				return fmt.Sprintf("agent:%s:main", agent.ID)
			}
		}
		return ""
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		available, err := ocClient.ListTemplates()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if available == nil {
			available = []dockerpkg.TemplateSummary{}
		}

		installed, _ := s.GetContainerTemplate(r.Context(), user.ID, store.ContainerTypeOpenClaw)
		activeSessionKey := ""
		if installed != "" {
			if tmpl, err := ocClient.GetTemplateSummary(installed); err == nil {
				activeSessionKey = leaderSessionKey(tmpl)
			}
		}

		writeJSON(w, http.StatusOK, response{
			Installed:        installed,
			ActiveSessionKey: activeSessionKey,
			Available:        available,
		})
	}
}

func installUserTeamHandler(s *store.Store, ocClient *dockerpkg.OpenClawClient, al *audit.Logger) http.HandlerFunc {
	type installRequest struct {
		Template string `json:"template"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req installRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		req.Template = strings.TrimSpace(req.Template)
		if req.Template == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "template is required"})
			return
		}

		info, err := s.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeOpenClaw)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "openclaw container not found"})
			return
		}

		result, err := ocClient.InstallTemplate(r.Context(), info, req.Template)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := s.SetContainerTemplate(r.Context(), user.ID, store.ContainerTypeOpenClaw, result.Template); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "team_install", "template", fmt.Sprintf("%s:%s", info.ContainerName, req.Template), r.RemoteAddr)
		writeJSON(w, http.StatusOK, result)
	}
}

const jamossProxyPrefix = "/api/jamoss"

func jamossProxyHandler(s *store.Store, ocClient *dockerpkg.OpenClawClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		upstreamPath, logicalPath := buildJaMOSSProxyPaths(r.URL.Path)
		if !isAllowedJaMOSSReadPath(logicalPath) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "jamoss path not allowed"})
			return
		}

		info, err := s.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeOpenClaw)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "openclaw container not found"})
			return
		}
		if info.ContainerIP == "" || info.HostPort == 0 {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw container endpoint unavailable"})
			return
		}

		if err := ocClient.EnsureRunning(r.Context(), info); err != nil {
			log.Warn().Err(err).Str("user_id", user.ID).Str("container", info.ContainerName).Msg("jamoss proxy: ensure running failed")
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw container unavailable"})
			return
		}

		if !ocClient.IsJaMOSSInstalled(info.ContainerName) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "jamoss not installed in this container"})
			return
		}

		// JaMOSS runs on port 6565 inside the container (same host as OpenClaw)
		target := &url.URL{Scheme: "http", Host: fmt.Sprintf("%s:%d", info.ContainerIP, 6565)}
		proxy := &httputil.ReverseProxy{
			Director: func(req *http.Request) {
				req.URL.Scheme = target.Scheme
				req.URL.Host = target.Host
				req.URL.Path = upstreamPath
				req.URL.RawPath = ""
				req.Host = target.Host
				req.Header.Del("Authorization")
				req.Header.Set("X-Admin-Token", info.ContainerToken)
			},
			ErrorHandler: func(w http.ResponseWriter, req *http.Request, err error) {
				log.Error().Err(err).Str("target", target.Host).Str("user_id", user.ID).Str("path", logicalPath).Msg("jamoss proxy error")
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "jamoss upstream unavailable"})
			},
		}

		proxy.ServeHTTP(w, r)
	}
}

func buildJaMOSSProxyPaths(requestPath string) (upstreamPath string, logicalPath string) {
	relative := strings.TrimPrefix(requestPath, jamossProxyPrefix)
	if relative == "" {
		relative = "/"
	}
	if !strings.HasPrefix(relative, "/") {
		relative = "/" + relative
	}
	clean := path.Clean(relative)
	if clean == "." {
		clean = "/"
	}
	return "/api" + clean, clean
}

func isAllowedJaMOSSReadPath(p string) bool {
	if p == "/admin/login" {
		return false
	}
	if strings.HasPrefix(p, "/admin/agents/") && strings.HasSuffix(p, "/reset-key") {
		return false
	}

	switch {
	case strings.HasPrefix(p, "/admin/tasks"):
		return true
	case strings.HasPrefix(p, "/admin/sub-tasks"):
		return true
	case p == "/agents":
		return true
	case strings.HasPrefix(p, "/scores/"):
		return true
	case strings.HasPrefix(p, "/review-records"):
		return true
	case strings.HasPrefix(p, "/logs"):
		return true
	case strings.HasPrefix(p, "/feed/"):
		return true
	case strings.HasPrefix(p, "/tasks"):
		return true
	case strings.HasPrefix(p, "/sub-tasks"):
		return true
	default:
		return false
	}
}

func installTemplateHandler(s *store.Store, ocClient *dockerpkg.OpenClawClient, al *audit.Logger) http.HandlerFunc {
	type installRequest struct {
		Template string `json:"template"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req installRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		req.Template = strings.TrimSpace(req.Template)
		if req.Template == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "template is required"})
			return
		}

		containerName := r.PathValue("id")
		info, err := s.GetContainerInfoByName(r.Context(), containerName)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
			return
		}

		if info.ContainerType != store.ContainerTypeOpenClaw {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "install-template only supported for openclaw containers"})
			return
		}

		result, err := ocClient.InstallTemplate(r.Context(), info, req.Template)
		if err != nil {
			switch {
			case errors.Is(err, dockerpkg.ErrTemplateNotFound):
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			case errors.Is(err, dockerpkg.ErrTemplatesDirNotFound):
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			default:
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			}
			return
		}

		al.Log(user.ID, "container_install_template", "container", fmt.Sprintf("%s:%s", containerName, req.Template), r.RemoteAddr)
		writeJSON(w, http.StatusOK, result)
	}
}

func startContainerHandler(client *dockerpkg.Client, s *store.Store, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		user := auth.GetUser(r.Context())
		if err := client.Start(id); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		if err := s.UpdateContainerStatusByName(r.Context(), id, "running"); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		al.Log(user.ID, "container_start", "container", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"status": "started", "container": id})
	}
}

func stopContainerHandler(client *dockerpkg.Client, s *store.Store, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		user := auth.GetUser(r.Context())
		if err := client.Stop(id); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		if err := s.UpdateContainerStatusByName(r.Context(), id, "stopped"); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		al.Log(user.ID, "container_stop", "container", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"status": "stopped", "container": id})
	}
}

func syncContainerConfigHandler(s *store.Store, ocClient *dockerpkg.OpenClawClient, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		user := auth.GetUser(r.Context())

		info, err := s.GetContainerInfoByName(r.Context(), id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
			return
		}

		if info.ContainerType != store.ContainerTypeOpenClaw {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sync-config only supported for openclaw containers"})
			return
		}

		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		changed, err := ocClient.SyncConfig(r.Context(), info)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "container_sync_config", "container", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"container": id,
			"changed":   changed,
		})
	}
}

func restartContainerHandler(vmClient *dockerpkg.Client, ocClient *dockerpkg.OpenClawClient, s *store.Store, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		user := auth.GetUser(r.Context())

		// Determine which docker client to use based on container type
		info, err := s.GetContainerInfoByName(r.Context(), id)
		var client *dockerpkg.Client
		if err == nil && info.ContainerType == store.ContainerTypeOpenClaw && ocClient != nil {
			client = ocClient.DockerClient()
		} else {
			client = vmClient
		}

		if err := client.Stop(id); err != nil {
			log.Warn().Err(err).Str("container", id).Msg("restart: stop failed (may already be stopped)")
		}

		time.Sleep(2 * time.Second)

		if err := client.Start(id); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": fmt.Sprintf("start failed: %s", err.Error())})
			return
		}

		if err := s.UpdateContainerStatusByName(r.Context(), id, "running"); err != nil {
			log.Warn().Err(err).Str("container", id).Msg("restart: update status failed")
		}

		al.Log(user.ID, "container_restart", "container", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"status": "restarted", "container": id})
	}
}

func provisionContainerHandler(s *store.Store, dockerClient *dockerpkg.Client, al *audit.Logger, cfg *config.Config) http.HandlerFunc {
	type provisionRequest struct {
		UserID   string `json:"user_id"`
		Username string `json:"username"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		var req provisionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		if req.UserID == "" || req.Username == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and username required"})
			return
		}

		admin := auth.GetUser(r.Context())

		containerToken, err := generateToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate container token"})
			return
		}
		containerName := containerNameForUser(req.UserID)
		hostPort := allocateHostPort(r.Context(), s, req.UserID)

		if err := s.CreateContainer(r.Context(), req.UserID, containerName, containerToken, hostPort, "vm-agent"); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "container record creation failed"})
			return
		}

		envVars := containerEnvVars(cfg)

		// Respond immediately — provisioning runs in background
		al.Log(admin.ID, "provision_container", "container", containerName, r.RemoteAddr)
		writeJSON(w, http.StatusAccepted, map[string]interface{}{
			"user_id":   req.UserID,
			"container": containerName,
			"status":    "provisioning",
		})

		go func() {
			ip, err := dockerClient.ProvisionContainer(containerName, req.UserID, containerToken, envVars, hostPort)
			if err != nil {
				log.Error().Err(err).Str("container", containerName).Msg("async provision failed")
				return
			}
			bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer bgCancel()
			if err := s.UpdateContainer(bgCtx, req.UserID, store.ContainerTypeVMAgent, containerName, ip, containerToken, hostPort); err != nil {
				log.Error().Err(err).Str("container", containerName).Msg("async provision: persist failed")
				return
			}
			log.Info().Str("container", containerName).Str("ip", ip).Str("user", req.Username).Msg("async provision complete")
		}()
	}
}

func createInviteCodeHandler(s *store.Store) http.HandlerFunc {
	type createRequest struct {
		Role      string `json:"role"`
		MaxUses   int    `json:"max_uses"`
		Note      string `json:"note"`
		ExpiresIn int    `json:"expires_in"` // hours, 0 = never
	}

	return func(w http.ResponseWriter, r *http.Request) {
		admin := auth.GetUser(r.Context())

		var req createRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.Role == "" {
			req.Role = "user"
		}
		if req.MaxUses <= 0 {
			req.MaxUses = 1
		}

		var expiresAt *time.Time
		if req.ExpiresIn > 0 {
			t := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)
			expiresAt = &t
		}

		code, err := s.CreateInviteCode(r.Context(), req.Role, admin.ID, req.Note, req.MaxUses, expiresAt)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create invite code"})
			return
		}

		writeJSON(w, http.StatusCreated, code)
	}
}

func listInviteCodesHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codes, err := s.ListInviteCodes(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list invite codes"})
			return
		}
		if codes == nil {
			codes = []store.InviteCode{}
		}
		writeJSON(w, http.StatusOK, codes)
	}
}

func listSessionsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		sessions, err := s.ListSessions(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list sessions"})
			return
		}
		if sessions == nil {
			sessions = []store.SessionSummary{}
		}
		writeJSON(w, http.StatusOK, sessions)
	}
}

func getSessionHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		sess, err := s.GetSession(r.Context(), user.ID, r.PathValue("id"))
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusOK, sess)
	}
}

func createSessionHandler(s *store.Store, dockerClient *dockerpkg.Client) http.HandlerFunc {
	type createSessionRequest struct {
		Type          string `json:"type"`
		WorkspacePath string `json:"workspace_path"`
		Model         string `json:"model"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req createSessionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		sess, err := s.CreateSession(r.Context(), user.ID, req.Type, req.WorkspacePath, req.Model)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create session"})
			return
		}

		writeJSON(w, http.StatusCreated, sess)
	}
}

func updateSessionHandler(s *store.Store) http.HandlerFunc {
	type updateRequest struct {
		Title         *string `json:"title"`
		Messages      *string `json:"messages"`
		Model         *string `json:"model"`
		WorkspacePath *string `json:"workspace_path"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		var req updateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		sess, err := s.UpdateSession(r.Context(), user.ID, r.PathValue("id"), store.SessionUpdate{
			Title:         req.Title,
			Messages:      req.Messages,
			Model:         req.Model,
			WorkspacePath: req.WorkspacePath,
		})
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		writeJSON(w, http.StatusOK, sess)
	}
}

func deleteSessionHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if err := s.DeleteSession(r.Context(), user.ID, r.PathValue("id")); err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// containerStatusHandler returns the user's container info (or 404 if none).
func containerStatusHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		info, err := s.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeVMAgent)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"provisioned": false,
				"ready":       false,
				"status":      "missing",
			})
			return
		}

		// A container record can exist while async provisioning is still in-flight
		// (status=creating, empty endpoint). Report readiness separately so desktop
		// doesn't start WS handshake too early and end up in reconnect/error loops.
		ready := info.ContainerName != "" && info.Status != "creating" && (info.HostPort > 0 || info.ContainerIP != "")
		resp := map[string]interface{}{
			"provisioned":    true,
			"ready":          ready,
			"status":         info.Status,
			"container_name": info.ContainerName,
			"container_ip":   info.ContainerIP,
			"container_type": info.ContainerType,
			"host_port":      info.HostPort,
		}
		if info.ContainerType == "openclaw" {
			resp["container_token"] = info.ContainerToken
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// selfProvisionHandler allows a user to provision their own container.
// Accepts optional container_type in request body: "vm-agent" (default) or "openclaw".
func selfProvisionHandler(s *store.Store, dockerClient *dockerpkg.Client, ocClient *dockerpkg.OpenClawClient, al *audit.Logger, cfg *config.Config) http.HandlerFunc {
	type provisionBody struct {
		ContainerType string `json:"container_type"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var body provisionBody
		_ = json.NewDecoder(r.Body).Decode(&body) // empty body is fine → defaults to vm-agent

		containerType := body.ContainerType
		if containerType == "" {
			containerType = "vm-agent"
		}
		if containerType != "vm-agent" && containerType != "openclaw" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid container_type"})
			return
		}

		if containerType == "openclaw" && ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		// Check if already provisioned
		info, err := s.GetContainerInfo(r.Context(), user.ID, containerType)
		if err == nil && info.ContainerIP != "" {
			resp := map[string]interface{}{
				"status":         "ready",
				"container_name": info.ContainerName,
				"container_type": info.ContainerType,
			}
			if info.ContainerType == "openclaw" {
				resp["container_token"] = info.ContainerToken
			}
			writeJSON(w, http.StatusOK, resp)
			return
		}

		containerToken, err := generateToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate container token"})
			return
		}

		var containerName string
		var hostPort int

		if containerType == "openclaw" {
			containerName = openClawContainerName(user.ID)
			hostPort = allocateOpenClawPort(r.Context(), s, user.ID)
		} else {
			containerName = containerNameForUser(user.ID)
			hostPort = allocateHostPort(r.Context(), s, user.ID)
		}

		if err := s.CreateContainer(r.Context(), user.ID, containerName, containerToken, hostPort, containerType); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "container record creation failed"})
			return
		}

		al.Log(user.ID, "self_provision", "container", containerName, r.RemoteAddr)
		resp := map[string]interface{}{
			"status":         "provisioning",
			"container_name": containerName,
			"container_type": containerType,
		}
		if containerType == "openclaw" {
			resp["container_token"] = containerToken
		}
		writeJSON(w, http.StatusAccepted, resp)

		userID := user.ID
		if containerType == "openclaw" {
			go func() {
				ip, err := ocClient.Provision(containerName, userID, containerToken, hostPort)
				if err != nil {
					log.Error().Err(err).Str("container", containerName).Str("user_id", userID).Msg("async openclaw provision failed")
					return
				}
				bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer bgCancel()
				if err := s.UpdateContainer(bgCtx, userID, store.ContainerTypeOpenClaw, containerName, ip, containerToken, hostPort); err != nil {
					log.Error().Err(err).Str("container", containerName).Str("user_id", userID).Msg("async openclaw provision: persist failed")
					return
				}
				log.Info().Str("container", containerName).Str("ip", ip).Str("user_id", userID).Msg("async openclaw provision complete")
			}()
		} else {
			envVars := containerEnvVars(cfg)
			go func() {
				ip, err := dockerClient.ProvisionContainer(containerName, userID, containerToken, envVars, hostPort)
				if err != nil {
					log.Error().Err(err).Str("container", containerName).Str("user_id", userID).Msg("async self-provision failed")
					return
				}
				bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer bgCancel()
				if err := s.UpdateContainer(bgCtx, userID, store.ContainerTypeVMAgent, containerName, ip, containerToken, hostPort); err != nil {
					log.Error().Err(err).Str("container", containerName).Str("user_id", userID).Msg("async self-provision: persist failed")
					return
				}
				log.Info().Str("container", containerName).Str("ip", ip).Str("user_id", userID).Msg("async self-provision complete")

				// Push memory + skills to newly provisioned vm-agent container
				bgCtx2 := context.Background()
				memFiles, err := s.GetAllMemoryFiles(bgCtx2, userID)
				if err == nil && len(memFiles) > 0 {
					fileMap := make(map[string]string, len(memFiles))
					for _, f := range memFiles {
						fileMap[f.FilePath] = f.Content
					}
					if err := dockerClient.PushMemoryFiles(containerName, fileMap); err != nil {
						log.Error().Err(err).Str("container", containerName).Msg("provision: push memory failed")
					}
				}
				for _, owner := range []string{"system", userID} {
					skillFiles, err := s.GetSkillFiles(bgCtx2, owner)
					if err == nil && len(skillFiles) > 0 {
						fileMap := make(map[string]string, len(skillFiles))
						for _, f := range skillFiles {
							fileMap[f.FilePath] = f.Content
						}
						if err := dockerClient.PushSkillFiles(containerName, fileMap); err != nil {
							log.Error().Err(err).Str("container", containerName).Msg("provision: push skills failed")
						}
					}
				}
			}()
		}
	}
}

func agentConfigHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		llm := cfg.GetLLM()
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"llm_proxy_url":      llm.ProxyURL,
			"llm_proxy_key":      llm.ProxyKey,
			"openai_api_key":     llm.OpenAIAPIKey,
			"exa_api_key":        llm.ExaAPIKey,
			"tavily_api_key":     llm.TavilyKey,
			"embedding_base_url": llm.EmbeddingBaseURL,
			"embedding_api_key":  llm.EmbeddingAPIKey,
			"fal_api_key":        llm.FalAPIKey,
			"jimeng_api_url":     llm.JimengAPIURL,
			"jimeng_api_key":     llm.JimengAPIKey,
			"primary_model":      llm.PrimaryModel,
			"primary_provider":   llm.PrimaryProvider,
			"models": []map[string]string{
				{"id": "claude-sonnet-4-6", "provider": "proxy-claude", "label": "Sonnet 4.6"},
				{"id": "claude-opus-4-6", "provider": "proxy-claude", "label": "Opus 4.6"},
				{"id": "claude-haiku-4-5", "provider": "proxy-claude", "label": "Haiku 4.5"},
				{"id": "gpt-5.3-codex", "provider": "proxy-gpt", "label": "GPT-5.3 Codex"},
				{"id": "gpt-5.4", "provider": "proxy-gpt", "label": "GPT-5.4"},
				{"id": "gemini-3.1-pro-preview", "provider": "proxy-gemini", "label": "Gemini 3.1 Pro"},
				{"id": "gemini-3-flash-preview", "provider": "proxy-gemini", "label": "Gemini 3 Flash"},
				{"id": "grok-4.1-fast", "provider": "proxy-grok", "label": "Grok 4.1 Fast"},
				{"id": "glm-5", "provider": "proxy-glm", "label": "GLM-5"},
			},
		})
	}
}

func getSettingsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		settings, err := s.GetAllSettings(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load settings"})
			return
		}
		writeJSON(w, http.StatusOK, settings)
	}
}

func updateSettingsHandler(s *store.Store, cfg *config.Config, al *audit.Logger, feishuBot *feishubot.Client, ghClient *github.Client, ph *postHogHolder) http.HandlerFunc {
	type updateRequest struct {
		Settings map[string]string `json:"settings"`
	}

	allowedKeys := map[string]bool{
		"llm_proxy_url":        true,
		"llm_proxy_key":        true,
		"openai_api_key":       true,
		"exa_api_key":          true,
		"tavily_api_key":       true,
		"embedding_base_url":   true,
		"embedding_api_key":    true,
		"fal_api_key":          true,
		"jimeng_api_url":       true,
		"jimeng_api_key":       true,
		"feishu_client_id":     true,
		"feishu_client_secret": true,
		"admin_token":          true,
		"github_token":         true,
		"github_repo":          true,
		"primary_model":        true,
		"primary_provider":     true,
		"posthog_api_key":      true,
		"posthog_endpoint":     true,
	}

	return func(w http.ResponseWriter, r *http.Request) {
		admin := auth.GetUser(r.Context())
		var req updateRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		for key, value := range req.Settings {
			if !allowedKeys[key] {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown setting: " + key})
				return
			}
			if err := s.SetSetting(r.Context(), key, value); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save setting: " + key})
				return
			}
		}

		// Hot-reload: refresh in-memory LLM config from DB
		llm := cfg.GetLLM()
		if v, ok := req.Settings["llm_proxy_url"]; ok && v != "" {
			llm.ProxyURL = v
		}
		if v, ok := req.Settings["llm_proxy_key"]; ok && v != "" {
			llm.ProxyKey = v
		}
		if v, ok := req.Settings["openai_api_key"]; ok {
			llm.OpenAIAPIKey = v
		}
		if v, ok := req.Settings["exa_api_key"]; ok {
			llm.ExaAPIKey = v
		}
		if v, ok := req.Settings["tavily_api_key"]; ok {
			llm.TavilyKey = v
		}
		if v, ok := req.Settings["embedding_base_url"]; ok {
			llm.EmbeddingBaseURL = v
		}
		if v, ok := req.Settings["embedding_api_key"]; ok {
			llm.EmbeddingAPIKey = v
		}
		if v, ok := req.Settings["fal_api_key"]; ok {
			llm.FalAPIKey = v
		}
		if v, ok := req.Settings["jimeng_api_url"]; ok {
			llm.JimengAPIURL = v
		}
		if v, ok := req.Settings["jimeng_api_key"]; ok {
			llm.JimengAPIKey = v
		}
		if v, ok := req.Settings["primary_model"]; ok {
			llm.PrimaryModel = v
		}
		if v, ok := req.Settings["primary_provider"]; ok {
			llm.PrimaryProvider = v
		}
		cfg.UpdateLLM(llm)

		if v, ok := req.Settings["feishu_client_id"]; ok {
			cfg.Auth.FeishuClientID = v
		}
		if v, ok := req.Settings["feishu_client_secret"]; ok {
			cfg.Auth.FeishuClientSecret = v
		}
		if v, ok := req.Settings["admin_token"]; ok && v != "" {
			cfg.Auth.AdminToken = v
		}
		if v, ok := req.Settings["github_token"]; ok {
			cfg.GitHub.Token = v
		}
		if v, ok := req.Settings["github_repo"]; ok {
			cfg.GitHub.Repo = v
		}
		ghClient.Update(cfg.GitHub.Token, cfg.GitHub.Repo)

		// Hot-reload Feishu Bot credentials
		feishuBot.UpdateCredentials(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret)

		// Hot-reload Goth Feishu SSO provider (re-register with new credentials)
		if cfg.Auth.FeishuClientID != "" && cfg.Auth.FeishuClientSecret != "" {
			baseURL := cfg.Server.PublicURL
			if baseURL == "" {
				baseURL = fmt.Sprintf("http://%s", cfg.Addr())
			}
			callbackURL := baseURL + "/api/auth/feishu/callback"
			goth.UseProviders(feishu.New(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret, callbackURL))
			log.Info().Str("callback", callbackURL).Msg("feishu SSO provider re-registered")
		}

		// Hot-reload PostHog client
		if _, ok := req.Settings["posthog_api_key"]; ok {
			cfg.PostHog.APIKey = req.Settings["posthog_api_key"]
		}
		if v, ok := req.Settings["posthog_endpoint"]; ok {
			cfg.PostHog.Endpoint = v
		}
		if _, ok := req.Settings["posthog_api_key"]; ok {
			ph.Reload(cfg.PostHog.APIKey, cfg.PostHog.Endpoint)
		}

		al.Log(admin.ID, "update_settings", "settings", "", r.RemoteAddr)

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func memoryStatsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		count, totalBytes, err := s.GetMemoryStats(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get memory stats"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"file_count":  count,
			"total_bytes": totalBytes,
		})
	}
}

func memoryClearHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		deleted, err := s.ClearAllMemory(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to clear memory"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]int64{
			"deleted_count": deleted,
		})
	}
}

func memorySyncHandler(s *store.Store) http.HandlerFunc {
	type manifestEntry struct {
		Path     string `json:"path"`
		Checksum string `json:"checksum"`
	}
	type pushEntry struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	type syncRequest struct {
		Manifest []manifestEntry `json:"manifest"`
		Push     []pushEntry     `json:"push"`
	}
	type pullEntry struct {
		Path     string `json:"path"`
		Content  string `json:"content"`
		Checksum string `json:"checksum"`
	}
	type syncResponse struct {
		Pull         []pullEntry `json:"pull"`
		PushAccepted []string    `json:"push_accepted"`
		ServerTime   string      `json:"server_time"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req syncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		clientChecksums := make(map[string]string, len(req.Manifest))
		for _, m := range req.Manifest {
			clientChecksums[m.Path] = m.Checksum
		}

		clientPush := make(map[string]string, len(req.Push))
		for _, p := range req.Push {
			clientPush[p.Path] = p.Content
		}

		serverFiles, err := s.GetMemoryManifest(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load server manifest"})
			return
		}

		serverChecksums := make(map[string]string, len(serverFiles))
		for _, f := range serverFiles {
			serverChecksums[f.FilePath] = f.Checksum
		}

		var pullPaths []string
		var pushAccepted []string

		for _, sf := range serverFiles {
			clientCk, clientHas := clientChecksums[sf.FilePath]
			if clientHas && clientCk == sf.Checksum {
				continue
			}

			if content, pushed := clientPush[sf.FilePath]; pushed {
				merged := content
				if strings.HasPrefix(sf.FilePath, "daily/") && clientCk != sf.Checksum {
					serverWithContent, err := s.GetMemoryFilesByPaths(r.Context(), user.ID, []string{sf.FilePath})
					if err != nil {
						log.Error().Err(err).Str("user_id", user.ID).Str("path", sf.FilePath).Msg("memory sync: load server daily log failed")
						writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load server memory file"})
						return
					}
					if len(serverWithContent) > 0 {
						merged = mergeDailyLogs(serverWithContent[0].Content, content)
					}
				}

				ck := store.ContentChecksum(merged)
				if err := s.UpsertMemoryFile(r.Context(), user.ID, sf.FilePath, merged, ck); err != nil {
					log.Error().Err(err).Str("user_id", user.ID).Str("path", sf.FilePath).Msg("memory sync: upsert merged file failed")
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save merged memory file"})
					return
				}
				pushAccepted = append(pushAccepted, sf.FilePath)
				continue
			}

			pullPaths = append(pullPaths, sf.FilePath)
		}

		for _, p := range req.Push {
			if _, onServer := serverChecksums[p.Path]; onServer {
				continue
			}

			ck := store.ContentChecksum(p.Content)
			if err := s.UpsertMemoryFile(r.Context(), user.ID, p.Path, p.Content, ck); err != nil {
				log.Error().Err(err).Str("user_id", user.ID).Str("path", p.Path).Msg("memory sync: upsert new file failed")
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save new memory file"})
				return
			}
			pushAccepted = append(pushAccepted, p.Path)
		}

		var pullFiles []pullEntry
		if len(pullPaths) > 0 {
			fetched, err := s.GetMemoryFilesByPaths(r.Context(), user.ID, pullPaths)
			if err != nil {
				log.Error().Err(err).Str("user_id", user.ID).Msg("memory sync: fetch pull files failed")
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load pull files"})
				return
			}

			for _, f := range fetched {
				pullFiles = append(pullFiles, pullEntry{
					Path:     f.FilePath,
					Content:  f.Content,
					Checksum: f.Checksum,
				})
			}
		}

		writeJSON(w, http.StatusOK, syncResponse{
			Pull:         pullFiles,
			PushAccepted: pushAccepted,
			ServerTime:   time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// mergeDailyLogs combines two daily log contents by deduplicating ## HH:MM entries.
func mergeDailyLogs(serverContent, clientContent string) string {
	type section struct {
		heading string
		body    string
	}

	parseSections := func(content string) []section {
		var sections []section
		lines := strings.Split(content, "\n")
		var current section
		for _, line := range lines {
			if strings.HasPrefix(line, "## ") {
				if current.heading != "" {
					sections = append(sections, current)
				}
				current = section{heading: line, body: ""}
			} else {
				current.body += line + "\n"
			}
		}
		if current.heading != "" {
			sections = append(sections, current)
		}
		return sections
	}

	serverSections := parseSections(serverContent)
	clientSections := parseSections(clientContent)

	seen := make(map[string]bool)
	var merged []section
	for _, s := range serverSections {
		seen[s.heading] = true
		merged = append(merged, s)
	}
	for _, c := range clientSections {
		if !seen[c.heading] {
			merged = append(merged, c)
		}
	}

	sort.Slice(merged, func(i, j int) bool {
		return merged[i].heading < merged[j].heading
	})

	var buf strings.Builder
	for _, s := range merged {
		buf.WriteString(s.heading)
		buf.WriteString("\n")
		buf.WriteString(s.body)
	}
	return strings.TrimRight(buf.String(), "\n") + "\n"
}

func skillsUploadHandler(s *store.Store) http.HandlerFunc {
	type fileEntry struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	type uploadRequest struct {
		Source string      `json:"source"`
		Files  []fileEntry `json:"files"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req uploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.Source != "builtin" && req.Source != "user" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "source must be 'builtin' or 'user'"})
			return
		}

		owner := user.ID
		if req.Source == "builtin" {
			owner = "system"
		}

		storeFiles := make([]store.SkillFile, 0, len(req.Files))
		for _, f := range req.Files {
			// Normalize path separators to forward slashes (Windows clients may send \)
			storeFiles = append(storeFiles, store.SkillFile{
				FilePath: filepath.ToSlash(f.Path),
				Content:  f.Content,
				Checksum: store.ContentChecksum(f.Content),
			})
		}

		if err := s.ReplaceSkillFiles(r.Context(), owner, storeFiles); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save skills"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":     "ok",
			"file_count": len(storeFiles),
		})
	}
}

func skillsChecksumHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		checksums, err := s.GetSkillChecksums(r.Context(), []string{"system", user.ID})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get checksums"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{
			"system": checksums["system"],
			"user":   checksums[user.ID],
		})
	}
}

func skillsPullHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		checksums, err := s.GetSkillChecksums(r.Context(), []string{"system"})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get checksums"})
			return
		}
		etag := checksums["system"]

		if etag != "" && r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}

		files, err := s.GetSkillFiles(r.Context(), "system")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load skills"})
			return
		}

		if etag != "" {
			w.Header().Set("ETag", etag)
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"files":    files,
			"checksum": etag,
		})
	}
}

// ─── Skills CRUD handlers ────────────────────────────────

func validateSkillID(skillID string) bool {
	if skillID == "" || len(skillID) > 128 {
		return false
	}
	if strings.Contains(skillID, "..") || strings.Contains(skillID, "/") || strings.Contains(skillID, "\\") {
		return false
	}
	return true
}

// pushSkillsToContainer asynchronously re-pushes all skill files (system + user) to the user's container.
func pushSkillsToContainer(s *store.Store, dc *dockerpkg.Client, userID string) {
	if dc == nil {
		return
	}
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()

		cInfo, err := s.GetContainerInfo(bgCtx, userID, store.ContainerTypeVMAgent)
		if err != nil || cInfo.Status != "running" {
			return
		}

		// Clear existing skills in container
		dc.Exec(cInfo.ContainerName, "sh", "-c", "rm -rf /home/agent/.jacoworks/skills/* 2>/dev/null; true")

		// Merge system + user skill files and push
		for _, owner := range []string{"system", userID} {
			files, err := s.GetSkillFiles(bgCtx, owner)
			if err != nil || len(files) == 0 {
				continue
			}
			fileMap := make(map[string]string, len(files))
			for _, f := range files {
				fileMap[f.FilePath] = f.Content
			}
			if err := dc.PushSkillFiles(cInfo.ContainerName, fileMap); err != nil {
				log.Warn().Err(err).Str("container", cInfo.ContainerName).Str("owner", owner).Msg("skill hot-push failed")
			}
		}

		log.Info().Str("container", cInfo.ContainerName).Str("user_id", userID).Msg("skill hot-push complete")
	}()
}

func skillsListHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		summaries, err := s.ListSkillSummaries(r.Context(), []string{"system", user.ID})
		if err != nil {
			log.Error().Err(err).Msg("list skill summaries")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list skills"})
			return
		}

		if summaries == nil {
			summaries = []store.SkillSummary{}
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"skills": summaries,
		})
	}
}

func skillsUpsertHandler(s *store.Store, dc *dockerpkg.Client) http.HandlerFunc {
	type fileEntry struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	type upsertRequest struct {
		Files []fileEntry `json:"files"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		skillID := r.PathValue("skillId")
		if !validateSkillID(skillID) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid skill id"})
			return
		}

		var req upsertRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if len(req.Files) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "files array is required"})
			return
		}

		// Prefix each file path with skillId/
		storeFiles := make([]store.SkillFile, 0, len(req.Files))
		for _, f := range req.Files {
			relPath := filepath.ToSlash(f.Path)
			storeFiles = append(storeFiles, store.SkillFile{
				FilePath: skillID + "/" + relPath,
				Content:  f.Content,
				Checksum: store.ContentChecksum(f.Content),
			})
		}

		if err := s.ReplaceSkillByPrefix(r.Context(), user.ID, skillID, storeFiles); err != nil {
			log.Error().Err(err).Str("skill_id", skillID).Msg("upsert skill")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save skill"})
			return
		}

		// Async hot-push to container
		pushSkillsToContainer(s, dc, user.ID)

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":     "ok",
			"skill_id":   skillID,
			"file_count": len(storeFiles),
		})
	}
}

func skillsDeleteHandler(s *store.Store, dc *dockerpkg.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		skillID := r.PathValue("skillId")
		if !validateSkillID(skillID) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid skill id"})
			return
		}

		if err := s.DeleteSkillByPrefix(r.Context(), user.ID, skillID); err != nil {
			log.Error().Err(err).Str("skill_id", skillID).Msg("delete skill")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete skill"})
			return
		}

		// Async hot-push to container
		pushSkillsToContainer(s, dc, user.ID)

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

func feedbackHandler(s *store.Store, gh *github.Client) http.HandlerFunc {
	type feedbackRequest struct {
		Category    string   `json:"category"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Images      []string `json:"images"`
		Version     string   `json:"version"`
	}

	categoryLabels := map[string]string{
		"bug":      "bug",
		"feature":  "enhancement",
		"question": "question",
		"other":    "feedback",
	}

	// DB feedback 表 category 列约束是 bug/feature/general，做映射。
	categoryDB := map[string]string{
		"bug":      "bug",
		"feature":  "feature",
		"question": "general",
		"other":    "general",
	}

	titlePrefix := map[string]string{
		"bug":      "[Bug]",
		"feature":  "[Feature]",
		"question": "[Question]",
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req feedbackRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}

		req.Category = strings.ToLower(strings.TrimSpace(req.Category))
		req.Title = strings.TrimSpace(req.Title)
		req.Description = strings.TrimSpace(req.Description)
		req.Version = strings.TrimSpace(req.Version)

		if req.Title == "" || req.Description == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title and description required"})
			return
		}

		if len(req.Images) > 3 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "max 3 images"})
			return
		}

		label, ok := categoryLabels[req.Category]
		if !ok {
			label = "feedback"
		}
		dbCat, ok := categoryDB[req.Category]
		if !ok {
			dbCat = "general"
		}

		// Upload images to GitHub.
		imageURLs := make([]string, 0, len(req.Images))
		if gh.Configured() {
			for i, img := range req.Images {
				img = strings.TrimSpace(img)
				if img == "" {
					continue
				}

				// Support optional data URL prefix: data:image/jpeg;base64,xxxx.
				if idx := strings.Index(img, ","); idx > 0 && strings.Contains(img[:idx], "base64") {
					img = img[idx+1:]
				}

				data, err := base64.StdEncoding.DecodeString(img)
				if err != nil {
					log.Warn().Err(err).Int("index", i).Msg("feedback: invalid base64 image, skipping")
					continue
				}

				now := time.Now()
				path := fmt.Sprintf("%s-%02d.jpg", now.Format("2006/01/02-150405"), i)
				rawURL, err := gh.UploadImage(path, data)
				if err != nil {
					log.Error().Err(err).Int("index", i).Msg("feedback: upload image failed")
					continue
				}
				imageURLs = append(imageURLs, rawURL)
			}
		}

		// Build issue body.
		var body strings.Builder
		body.WriteString(req.Description)
		body.WriteString("\n\n")
		for _, imageURL := range imageURLs {
			body.WriteString(fmt.Sprintf("![screenshot](%s)\n\n", imageURL))
		}
		body.WriteString("---\n")
		body.WriteString(fmt.Sprintf("> 提交者: %s | 版本: %s | 时间: %s\n",
			user.Name,
			req.Version,
			time.Now().Format("2006-01-02 15:04"),
		))

		issueNumber := 0
		issueURL := ""
		if gh.Configured() {
			prefix := titlePrefix[req.Category]
			if prefix == "" {
				prefix = "[Feedback]"
			}

			var err error
			issueNumber, issueURL, err = gh.CreateIssue(
				fmt.Sprintf("%s %s", prefix, req.Title),
				body.String(),
				[]string{label},
			)
			if err != nil {
				log.Error().Err(err).Msg("feedback: create github issue failed")
			}
		}

		if _, err := s.Pool().Exec(
			r.Context(),
			`INSERT INTO feedback (id, name, email, category, message, status, created_at, updated_at)
			 VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'open', now(), now())`,
			user.Name,
			user.Email,
			dbCat,
			req.Description,
		); err != nil {
			log.Error().Err(err).Msg("feedback: save to db failed")
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"issue_number": issueNumber,
			"issue_url":    issueURL,
		})
	}
}

// --- Cron Job Handlers ---

func createCronJobHandler(s *store.Store) http.HandlerFunc {
	type createRequest struct {
		ScheduleKind   string  `json:"schedule_kind"`
		ScheduleExpr   string  `json:"schedule_expr"`
		Prompt         string  `json:"prompt"`
		Name           *string `json:"name"`
		SessionTarget  string  `json:"session_target"`
		DeleteAfterRun bool    `json:"delete_after_run"`
		DeliveryMode   *string `json:"delivery_mode"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		var req createRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.ScheduleKind == "" || req.ScheduleExpr == "" || req.Prompt == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "schedule_kind, schedule_expr, and prompt are required"})
			return
		}

		job, err := s.CreateCronJob(r.Context(), user.ID, req.ScheduleKind, req.ScheduleExpr, req.Prompt, req.Name, req.SessionTarget, req.DeleteAfterRun, req.DeliveryMode)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create cron job"})
			return
		}
		writeJSON(w, http.StatusCreated, job)
	}
}

func listCronJobsHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		jobs, err := s.ListCronJobs(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to list cron jobs"})
			return
		}
		if jobs == nil {
			jobs = []store.CronJob{}
		}
		writeJSON(w, http.StatusOK, jobs)
	}
}

func deleteCronJobHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if err := s.DeleteCronJob(r.Context(), user.ID, r.PathValue("id")); err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "cron job not found"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func runCronJobHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "pending",
			"message": "Gateway-side cron execution not yet implemented. Job is stored and will be executed when the gateway scheduler is built.",
		})
	}
}

func cronJobHistoryHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "pending",
			"message": "No run history available yet. Gateway-side cron execution is not yet implemented.",
		})
	}
}

func adminLogsHandler(dockerClient *dockerpkg.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		service := r.URL.Query().Get("service")
		container := r.URL.Query().Get("container")
		level := r.URL.Query().Get("level")
		search := r.URL.Query().Get("search")
		linesStr := r.URL.Query().Get("lines")

		lines := 200
		if linesStr != "" {
			if n, err := strconv.Atoi(linesStr); err == nil && n > 0 && n <= 1000 {
				lines = n
			}
		}

		var rawLogs string
		var err error

		switch service {
		case "agent":
			if container == "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "container parameter required for agent logs"})
				return
			}
			rawLogs, err = dockerClient.ContainerLogs(container, lines)
			if err != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("failed to fetch container logs: %v", err)})
				return
			}
		case "gateway", "":
			args := []string{
				"-u", "jacoworks-gateway",
				"--output=json",
				"--no-pager",
				"-n", fmt.Sprintf("%d", lines),
			}
			if since := r.URL.Query().Get("since"); since != "" {
				args = append(args, "--since", since)
			}
			cmd := exec.Command("journalctl", args...)
			out, cmdErr := cmd.CombinedOutput()
			if cmdErr != nil {
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("journalctl failed: %v", cmdErr)})
				return
			}
			rawLogs = string(out)
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "service must be 'gateway' or 'agent'"})
			return
		}

		type LogEntry struct {
			Level     string `json:"level"`
			Msg       string `json:"msg"`
			Ts        string `json:"ts"`
			TraceID   string `json:"trace_id,omitempty"`
			SessionID string `json:"session_id,omitempty"`
			UserID    string `json:"user_id,omitempty"`
			Service   string `json:"service,omitempty"`
			Raw       string `json:"raw,omitempty"`
		}

		var entries []LogEntry
		for _, line := range strings.Split(rawLogs, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			var entry map[string]interface{}
			if err := json.Unmarshal([]byte(line), &entry); err != nil {
				entries = append(entries, LogEntry{
					Level: "info",
					Msg:   line,
					Raw:   line,
				})
				continue
			}

			le := LogEntry{}

			if service == "gateway" || service == "" {
				if msg, ok := entry["MESSAGE"].(string); ok {
					var inner map[string]interface{}
					if json.Unmarshal([]byte(msg), &inner) == nil {
						le.Level = strVal(inner, "level")
						le.Msg = strVal(inner, "message")
						if le.Msg == "" {
							le.Msg = strVal(inner, "msg")
						}
						le.TraceID = strVal(inner, "trace_id")
						le.SessionID = strVal(inner, "session_id")
						le.UserID = strVal(inner, "user_id")
						le.Service = "gateway"
						if ts, ok := entry["__REALTIME_TIMESTAMP"].(string); ok {
							if tsInt, err := strconv.ParseInt(ts, 10, 64); err == nil {
								le.Ts = time.Unix(0, tsInt*1000).UTC().Format(time.RFC3339Nano)
							}
						}
					} else {
						le.Level = "info"
						le.Msg = msg
						le.Service = "gateway"
						le.Raw = msg
					}
				} else {
					continue
				}
			} else {
				le.Level = strVal(entry, "level")
				le.Msg = strVal(entry, "msg")
				le.Ts = strVal(entry, "ts")
				le.TraceID = strVal(entry, "trace_id")
				le.SessionID = strVal(entry, "session_id")
				le.UserID = strVal(entry, "user_id")
				le.Service = strVal(entry, "service")
				if le.Service == "" {
					le.Service = "vm-agent"
				}
			}

			if level != "" && le.Level != level {
				continue
			}

			if search != "" {
				searchLower := strings.ToLower(search)
				if !strings.Contains(strings.ToLower(le.Msg), searchLower) &&
					!strings.Contains(strings.ToLower(le.TraceID), searchLower) &&
					!strings.Contains(strings.ToLower(le.SessionID), searchLower) &&
					!strings.Contains(strings.ToLower(le.UserID), searchLower) &&
					!strings.Contains(strings.ToLower(le.Raw), searchLower) {
					continue
				}
			}

			entries = append(entries, le)
		}

		if entries == nil {
			entries = []LogEntry{}
		}

		writeJSON(w, http.StatusOK, entries)
	}
}

func strVal(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		switch t := v.(type) {
		case string:
			return t
		case float64:
			return fmt.Sprintf("%.0f", t)
		default:
			return fmt.Sprintf("%v", v)
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// containerEnvVars builds the environment variables to inject into a new container.
// Includes all LLM-related keys that vm-agent's config.ts reads from env.
func containerEnvVars(cfg *config.Config) map[string]string {
	llm := cfg.GetLLM()
	env := map[string]string{
		"LLM_PROXY_URL":  llm.ProxyURL,
		"LLM_PROXY_KEY":  llm.ProxyKey,
		"OPENAI_API_KEY": llm.OpenAIAPIKey,
		"FAL_API_KEY":    llm.FalAPIKey,
	}
	// Optional keys — only inject if configured
	if llm.EmbeddingAPIKey != "" {
		env["EMBEDDING_API_KEY"] = llm.EmbeddingAPIKey
	}
	if llm.EmbeddingBaseURL != "" {
		env["EMBEDDING_BASE_URL"] = llm.EmbeddingBaseURL
	}
	if llm.TavilyKey != "" {
		env["TAVILY_API_KEY"] = llm.TavilyKey
	}
	if llm.ExaAPIKey != "" {
		env["EXA_API_KEY"] = llm.ExaAPIKey
	}
	if llm.JimengAPIURL != "" {
		env["JIMENG_API_URL"] = llm.JimengAPIURL
	}
	if llm.JimengAPIKey != "" {
		env["JIMENG_API_KEY"] = llm.JimengAPIKey
	}
	if llm.PrimaryModel != "" {
		env["PRIMARY_MODEL"] = llm.PrimaryModel
	}
	if llm.PrimaryProvider != "" {
		env["PRIMARY_PROVIDER"] = llm.PrimaryProvider
	}
	if cfg.Docker.GatewayToken != "" {
		env["GATEWAY_TOKEN"] = cfg.Docker.GatewayToken
	}
	if cfg.Server.PublicURL != "" {
		env["GATEWAY_URL"] = cfg.Server.PublicURL
	}
	return env
}

func containerNameForUser(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return "agent-" + hex.EncodeToString(sum[:8])
}

func openClawContainerName(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return "oc-" + hex.EncodeToString(sum[:8])
}

// allocateHostPort assigns a unique host port from the range [19000, 19999].
// It uses a deterministic base from the user ID hash and probes for an unused port.
func allocateHostPort(ctx context.Context, s *store.Store, userID string) int {
	sum := sha256.Sum256([]byte(userID))
	base := int(sum[0])<<8 | int(sum[1])
	port := 19000 + (base % 1000)
	// Simple approach: deterministic mapping. Collisions are rare with <1000 users.
	// For production scale, query DB for used ports and find a free one.
	return port
}

func allocateOpenClawPort(ctx context.Context, s *store.Store, userID string) int {
	sum := sha256.Sum256([]byte(userID))
	base := int(sum[0])<<8 | int(sum[1])
	return 18800 + (base % 200) // Keep range small: 18800-18999
}

func isTerminal() bool {
	fi, err := os.Stderr.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

// posthogCallback logs PostHog event delivery results.
type posthogCallback struct{}

func (c *posthogCallback) Success(msg posthog.APIMessage) {
	log.Info().Str("type", fmt.Sprintf("%T", msg)).Msg("posthog: event delivered")
}

func (c *posthogCallback) Failure(msg posthog.APIMessage, err error) {
	log.Error().Err(err).Str("type", fmt.Sprintf("%T", msg)).Msg("posthog: event delivery failed")
}

// postHogHolder wraps a PostHog client for hot-reload via admin settings.
type postHogHolder struct {
	mu     sync.RWMutex
	client posthog.Client
}

func (h *postHogHolder) Reload(apiKey, endpoint string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.client != nil {
		h.client.Close()
		h.client = nil
	}
	if apiKey == "" {
		log.Info().Msg("posthog client disabled (no api key)")
		return
	}
	opts := posthog.Config{
		Verbose:  true,
		Callback: &posthogCallback{},
	}
	if endpoint != "" {
		opts.Endpoint = endpoint
	}
	c, err := posthog.NewWithConfig(apiKey, opts)
	if err != nil {
		log.Error().Err(err).Msg("posthog client init failed")
		return
	}
	h.client = c
	log.Info().Str("endpoint", endpoint).Msg("posthog client initialized")
}

func (h *postHogHolder) Get() posthog.Client {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.client
}

// CaptureEvent sends an event to PostHog if the client is initialized.
func (h *postHogHolder) CaptureEvent(distinctID, event string, properties map[string]interface{}) {
	c := h.Get()
	if c == nil {
		return
	}
	props := posthog.NewProperties()
	for k, v := range properties {
		props.Set(k, v)
	}
	if err := c.Enqueue(posthog.Capture{
		DistinctId: distinctID,
		Event:      event,
		Properties: props,
	}); err != nil {
		log.Error().Err(err).Str("event", event).Msg("posthog: enqueue failed")
	} else {
		log.Info().Str("event", event).Msg("posthog: event enqueued")
	}
}

func (h *postHogHolder) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.client != nil {
		h.client.Close()
		h.client = nil
	}
}
