package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/agent"
	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	containerpkg "github.com/fran0220/jacoworks/gateway/internal/container"
	incuspkg "github.com/fran0220/jacoworks/gateway/internal/incus"
	"github.com/fran0220/jacoworks/gateway/internal/middleware"
	ocpkg "github.com/fran0220/jacoworks/gateway/internal/openclaw"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

func main() {
	configPath := "oc-gateway.yaml"
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

	ctx := context.Background()
	s, err := store.New(ctx, cfg.Database.URL)
	if err != nil {
		log.Fatal().Err(err).Msg("init database")
	}
	defer s.Close()

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
			case "mineru_token":
				llm.MineruToken = setting.Value
			case "jimeng_api_url":
				llm.JimengAPIURL = setting.Value
			case "jimeng_api_key":
				llm.JimengAPIKey = setting.Value
			case "primary_model":
				llm.PrimaryModel = setting.Value
			case "primary_provider":
				llm.PrimaryProvider = setting.Value
			case "admin_token":
				cfg.Auth.AdminToken = setting.Value
			}
		}
		cfg.UpdateLLM(llm)
		log.Info().Msg("loaded settings from database")
	} else {
		log.Warn().Err(err).Msg("load settings from database failed")
	}

	auditLogger := audit.NewLogger(s.Pool())

	incusRT, err := incuspkg.NewClient("", cfg.OpenClaw.HostIP)
	if err != nil {
		log.Fatal().Err(err).Msg("init incus client")
	}
	ocClient := ocpkg.NewClient(incusRT, cfg.OpenClaw.DataRoot, cfg.OpenClaw.HostIP, cfg.OpenClaw.Image, cfg.GetLLM, s)

	ocFreezer := containerpkg.NewFreezerWithPrefix(incusRT, "oc-", 30*time.Minute, 2*time.Hour, 5*time.Minute)
	ocFreezer.Start()
	defer ocFreezer.Stop()
	ocFreezer.SetOnAfterFreeze(func(containerName string) {
		if err := s.UpdateContainerStatusByName(context.Background(), containerName, "stopped"); err != nil {
			log.Error().Err(err).Str("container", containerName).Msg("openclaw idle stop: update status failed")
		}
	})

	log.Info().
		Str("image", cfg.OpenClaw.Image).
		Str("host_ip", cfg.OpenClaw.HostIP).
		Msg("openclaw backend initialized (incus)")

	authMiddleware := auth.NewMiddleware(s, cfg.Auth.AdminToken)

	ocDialer := agent.NewOpenClawDialer(s, ocClient, ocFreezer)
	ocDialer.SetAutoPairEnabled(true)
	dialers := map[string]agent.UpstreamDialer{
		store.ContainerTypeOpenClaw: ocDialer,
	}

	channelPool := agent.NewChannelPool(s, dialers, 5*time.Minute, 1024)
	defer channelPool.Close()

	wsTicketStore := agent.NewTicketStore(30 * time.Second)
	defer wsTicketStore.Close()

	wsHandler := agent.NewWSHandler(channelPool, wsTicketStore, func(userID, event string, properties map[string]interface{}) {})
	sseHandler := agent.NewSSEHandler(channelPool)

	mux := http.NewServeMux()

	mux.Handle("POST /api/oc/ws-ticket", authMiddleware.Authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wsTicketStore.IssueTicket(w, r)
	})))

	mux.Handle("GET /ws/oc", wsHandler)

	mux.Handle("GET /api/oc/stream", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.StreamEvents)))
	mux.Handle("POST /api/oc/send", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.SendCommand)))
	mux.Handle("GET /api/oc/status", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.GetStatus)))

	mux.Handle("GET /api/cowork/container-status", authMiddleware.Authenticate(http.HandlerFunc(containerStatusHandler(s))))
	mux.Handle("POST /api/cowork/provision", authMiddleware.Authenticate(http.HandlerFunc(selfProvisionHandler(s, ocClient, auditLogger))))

	mux.Handle("GET /api/teams", authMiddleware.Authenticate(http.HandlerFunc(userTeamsHandler(s, ocClient))))
	mux.Handle("POST /api/teams/install", authMiddleware.Authenticate(http.HandlerFunc(installUserTeamHandler(s, ocClient, auditLogger))))

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

	mux.Handle("POST /api/admin/containers/{id}/sync-config", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(syncContainerConfigHandler(s, ocClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/install-template", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(installTemplateHandler(s, ocClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/restart", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(restartContainerHandler(ocClient, s, auditLogger)))))

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	handler := middleware.PanicRecovery(
		middleware.RequestID(
			middleware.RequestLog(
				corsMiddleware(mux),
			),
		),
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

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Error().Err(err).Msg("shutdown error")
		}
	}()

	log.Info().Str("addr", cfg.Addr()).Msg("starting oc-gateway")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal().Err(err).Msg("server error")
	}
}

var allowedOrigins = map[string]bool{
	"http://localhost:1420":       true,
	"tauri://localhost":           true,
	"https://tauri.localhost":     true,
	"https://jaco.jingao.club":    true,
	"https://jacoapi.jingao.club": true,
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
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

func containerStatusHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		containerType := strings.TrimSpace(r.URL.Query().Get("container_type"))
		if containerType == "" {
			containerType = store.ContainerTypeOpenClaw
		}
		if containerType != store.ContainerTypeOpenClaw {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid container_type"})
			return
		}

		info, err := s.GetContainerInfo(r.Context(), user.ID, containerType)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"provisioned":    false,
				"ready":          false,
				"status":         "missing",
				"container_type": store.ContainerTypeOpenClaw,
			})
			return
		}

		ready := info.ContainerName != "" && info.Status == "running" && (info.HostPort > 0 || info.ContainerIP != "")
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"provisioned":     true,
			"ready":           ready,
			"status":          info.Status,
			"container_name":  info.ContainerName,
			"container_ip":    info.ContainerIP,
			"container_type":  info.ContainerType,
			"host_port":       info.HostPort,
			"container_token": info.ContainerToken,
		})
	}
}

func selfProvisionHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
	type provisionBody struct {
		ContainerType string `json:"container_type"`
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

		var body provisionBody
		_ = json.NewDecoder(r.Body).Decode(&body)

		containerType := strings.TrimSpace(body.ContainerType)
		if containerType == "" {
			containerType = store.ContainerTypeOpenClaw
		}
		if containerType != store.ContainerTypeOpenClaw {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid container_type"})
			return
		}

		info, err := s.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeOpenClaw)
		if err == nil && info.ContainerName != "" {
			if info.Status != "running" && info.Status != "creating" {
				if startErr := ocClient.EnsureRunning(r.Context(), info); startErr != nil {
					log.Warn().Err(startErr).Str("container", info.ContainerName).Msg("self-provision: ensure running failed")
				} else {
					_ = s.UpdateContainerStatusByName(r.Context(), info.ContainerName, "running")
				}
			}

			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":          "ready",
				"container_name":  info.ContainerName,
				"container_type":  info.ContainerType,
				"container_token": info.ContainerToken,
			})
			return
		}

		containerToken, err := generateToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate container token"})
			return
		}

		containerName := openClawContainerName(user.ID)
		hostPort := allocateOpenClawPort(r.Context(), s, user.ID)

		if err := s.CreateContainer(r.Context(), user.ID, containerName, containerToken, hostPort, store.ContainerTypeOpenClaw); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "container record creation failed"})
			return
		}

		al.Log(user.ID, "self_provision", "container", containerName, r.RemoteAddr)
		writeJSON(w, http.StatusAccepted, map[string]interface{}{
			"status":          "provisioning",
			"container_name":  containerName,
			"container_type":  store.ContainerTypeOpenClaw,
			"container_token": containerToken,
		})

		userID := user.ID
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
	}
}

func userTeamsHandler(s *store.Store, ocClient *ocpkg.Client) http.HandlerFunc {
	type response struct {
		Installed        string                    `json:"installed"`
		ActiveSessionKey string                    `json:"activeSessionKey"`
		Available        []ocpkg.TemplateSummary   `json:"available"`
	}

	leaderSessionKey := func(tmpl *ocpkg.TemplateSummary) string {
		if tmpl == nil {
			return ""
		}
		for _, teamAgent := range tmpl.Agents {
			if teamAgent.IsLeader && strings.TrimSpace(teamAgent.ID) != "" {
				return fmt.Sprintf("agent:%s:main", teamAgent.ID)
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
			available = []ocpkg.TemplateSummary{}
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

func installUserTeamHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

func jamossProxyHandler(s *store.Store, ocClient *ocpkg.Client) http.HandlerFunc {
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

		if !ocClient.IsJMOSInstalled(info.ContainerName) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "jmos not installed in this container"})
			return
		}

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

func installTemplateHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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
			case errors.Is(err, ocpkg.ErrTemplateNotFound):
				writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			case errors.Is(err, ocpkg.ErrTemplatesDirNotFound):
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

func syncContainerConfigHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

func restartContainerHandler(ocClient *ocpkg.Client, s *store.Store, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		user := auth.GetUser(r.Context())

		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}

		info, err := s.GetContainerInfoByName(r.Context(), id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
			return
		}
		if info.ContainerType != store.ContainerTypeOpenClaw {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "restart only supported for openclaw containers"})
			return
		}

		rt := ocClient.Runtime()
		if err := rt.Stop(r.Context(), id); err != nil {
			log.Warn().Err(err).Str("container", id).Msg("restart: stop failed (may already be stopped)")
		}

		time.Sleep(2 * time.Second)

		if err := rt.Start(r.Context(), id); err != nil {
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

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func openClawContainerName(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return "oc-" + hex.EncodeToString(sum[:8])
}

func allocateOpenClawPort(ctx context.Context, s *store.Store, userID string) int {
	sum := sha256.Sum256([]byte(userID))
	base := int(sum[0])<<8 | int(sum[1])
	return 18800 + (base % 200)
}

func isTerminal() bool {
	fi, err := os.Stderr.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
