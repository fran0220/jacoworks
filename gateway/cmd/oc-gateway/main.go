package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/markbates/goth"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/agent"
	"github.com/fran0220/jacoworks/gateway/internal/auth/feishu"
	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/feishubot"
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
			case "posthog_api_key":
				cfg.PostHog.APIKey = setting.Value
			case "posthog_endpoint":
				cfg.PostHog.Endpoint = setting.Value
			case "feishu_client_id":
				cfg.Auth.FeishuClientID = setting.Value
			case "feishu_client_secret":
				cfg.Auth.FeishuClientSecret = setting.Value
			}
		}
		// oc-gateway specific overrides: oc_primary_model / oc_primary_provider
		// take precedence over the shared primary_model / primary_provider keys,
		// allowing desktop and webchat to use different default models.
		for _, setting := range dbSettings {
			if setting.Value == "" {
				continue
			}
			switch setting.Key {
			case "oc_primary_model":
				llm.PrimaryModel = setting.Value
			case "oc_primary_provider":
				llm.PrimaryProvider = setting.Value
			}
		}
		cfg.UpdateLLM(llm)
		log.Info().Msg("loaded settings from database")
	} else {
		log.Warn().Err(err).Msg("load settings from database failed")
	}

	// Initialize Goth providers (Feishu SSO)
	if cfg.Auth.FeishuClientID != "" {
		baseURL := cfg.Server.PublicURL
		if baseURL == "" {
			baseURL = fmt.Sprintf("http://%s", cfg.Addr())
		}
		callbackURL := baseURL + "/api/auth/feishu/callback"
		goth.UseProviders(feishu.New(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret, callbackURL))
		log.Info().Str("callback", callbackURL).Msg("feishu SSO provider registered")
	}

	auditLogger := audit.NewLogger(s.Pool())

	incusRT, err := incuspkg.NewClient("", cfg.OpenClaw.HostIP)
	if err != nil {
		log.Fatal().Err(err).Msg("init incus client")
	}
	ocClient := ocpkg.NewClient(incusRT, cfg.OpenClaw.DataRoot, cfg.OpenClaw.HostIP, cfg.OpenClaw.Image, cfg.GetLLM, s)

	// Freeze disabled: VMs stay running permanently for instant WS connection.
	// Previously: freeze after 1h idle → unpause + health poll added 5-30s to every reconnect.

	log.Info().
		Str("image", cfg.OpenClaw.Image).
		Str("host_ip", cfg.OpenClaw.HostIP).
		Msg("openclaw backend initialized (incus)")

	authMiddleware := auth.NewMiddleware(s, cfg.Auth.AdminToken)
	authHandlers := auth.NewHandlers(s, cfg.Auth.SessionTTLHours)
	chatTemplate, err := loadHTMLTemplate("chat", "data/chat.html", "gateway/data/chat.html")
	if err != nil {
		log.Fatal().Err(err).Msg("load chat template")
	}
	loginTemplate, err := loadHTMLTemplate("login", "data/login.html", "gateway/data/login.html")
	if err != nil {
		log.Fatal().Err(err).Msg("load login template")
	}

	ocDialer := agent.NewOpenClawDialer(s, ocClient, nil)
	ocDialer.SetAutoPairEnabled(true)
	dialers := map[string]agent.UpstreamDialer{
		store.ContainerTypeOpenClaw: ocDialer,
	}

	channelPool := agent.NewChannelPool(s, dialers, 5*time.Minute, 1024)
	defer channelPool.Close()

	// Initialize Feishu Bot handler (shares ChannelPool with webchat for conversation sync)
	feishuBotClient := feishubot.NewClient(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret)
	feishuBotHandler := feishubot.NewHandler(feishuBotClient, s, channelPool)

	wsTicketStore := agent.NewTicketStore(30 * time.Second)
	defer wsTicketStore.Close()

	wsHandler := agent.NewWSHandler(channelPool, wsTicketStore, func(userID, event string, properties map[string]interface{}) {})
	sseHandler := agent.NewSSEHandler(channelPool)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/chat", http.StatusFound)
	})
	mux.Handle("GET /login", http.HandlerFunc(loginPageHandler(loginTemplate)))
	// Generate cache-bust token at startup so browser always loads fresh JS/CSS after deploy.
	cacheBustBytes := make([]byte, 4)
	_, _ = rand.Read(cacheBustBytes)
	cacheBust := hex.EncodeToString(cacheBustBytes)
	mux.Handle("GET /chat", authMiddleware.AuthenticateWithRedirect("/login", http.HandlerFunc(chatPageHandler(s, cfg, chatTemplate, cacheBust))))

	if staticDir := strings.TrimSpace(cfg.Server.StaticDir); staticDir != "" {
		staticRoot := filepath.Clean(staticDir)
		log.Info().Str("path", staticRoot).Msg("serving static assets")
		mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.Dir(staticRoot))))
	} else {
		log.Warn().Msg("server.static_dir is empty; /static/* will return 503")
		mux.HandleFunc("GET /static/", func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "static assets not configured", http.StatusServiceUnavailable)
		})
	}

	mux.HandleFunc("POST /api/auth/login", authHandlers.Login)
	mux.HandleFunc("POST /api/auth/activate", authHandlers.Activate)
	mux.HandleFunc("GET /api/auth/feishu", authHandlers.FeishuBegin)
	mux.HandleFunc("GET /api/auth/feishu/callback", authHandlers.FeishuCallback)
	mux.Handle("POST /api/auth/logout", authMiddleware.Authenticate(http.HandlerFunc(authHandlers.Logout)))
	mux.Handle("GET /api/users/me", authMiddleware.Authenticate(http.HandlerFunc(meHandler)))
	mux.Handle("GET /api/sessions", authMiddleware.Authenticate(http.HandlerFunc(listSessionsHandler(s))))
	mux.Handle("POST /api/sessions", authMiddleware.Authenticate(http.HandlerFunc(createSessionHandler(s))))
	mux.Handle("GET /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(getSessionHandler(s))))
	mux.Handle("PUT /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(updateSessionHandler(s))))
	mux.Handle("DELETE /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(deleteSessionHandler(s))))
	mux.Handle("POST /api/cron/jobs", authMiddleware.Authenticate(http.HandlerFunc(createCronJobHandler(s))))
	mux.Handle("GET /api/cron/jobs", authMiddleware.Authenticate(http.HandlerFunc(listCronJobsHandler(s))))
	mux.Handle("DELETE /api/cron/jobs/{id}", authMiddleware.Authenticate(http.HandlerFunc(deleteCronJobHandler(s))))

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

	// VNC reverse proxy (authenticated, per-user)
	vncHandler := authMiddleware.Authenticate(http.HandlerFunc(vncProxyHandler(s, cfg.OpenClaw.HostIP)))
	mux.Handle("GET /vnc/", vncHandler)
	mux.Handle("GET /websockify", authMiddleware.Authenticate(http.HandlerFunc(vncWebsockifyHandler(s))))

	mux.Handle("POST /api/admin/containers/{id}/sync-config", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(syncContainerConfigHandler(s, ocClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/install-template", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(installTemplateHandler(s, ocClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/restart", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(restartContainerHandler(ocClient, s, auditLogger)))))

	// Profile CRUD (user-level)
	mux.Handle("GET /api/profiles", authMiddleware.Authenticate(http.HandlerFunc(userListProfilesHandler(s, ocClient))))
	mux.Handle("GET /api/profiles/{name}", authMiddleware.Authenticate(http.HandlerFunc(userGetProfileHandler(ocClient))))
	mux.Handle("POST /api/profiles", authMiddleware.Authenticate(http.HandlerFunc(userCreateProfileHandler(s, ocClient, auditLogger))))
	mux.Handle("PUT /api/profiles/{name}", authMiddleware.Authenticate(http.HandlerFunc(userUpdateProfileHandler(s, ocClient, auditLogger))))
	mux.Handle("DELETE /api/profiles/{name}", authMiddleware.Authenticate(http.HandlerFunc(userDeleteProfileHandler(s, ocClient, auditLogger))))

	// Template CRUD (read: user-level, write: admin-only)
	mux.Handle("GET /api/templates", authMiddleware.Authenticate(http.HandlerFunc(listTemplatesAdminHandler(ocClient))))
	mux.Handle("GET /api/templates/{name}", authMiddleware.Authenticate(http.HandlerFunc(getTemplateHandler(ocClient))))
	mux.Handle("POST /api/admin/templates", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(createTemplateHandler(s, ocClient, auditLogger)))))
	mux.Handle("PUT /api/admin/templates/{name}", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(updateTemplateHandler(s, ocClient, auditLogger)))))
	mux.Handle("DELETE /api/admin/templates/{name}", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(deleteTemplateHandler(s, ocClient, auditLogger)))))

	// Feishu bot chat proxy endpoint (called by gateway's feishu webhook handler)
	mux.HandleFunc("POST /api/feishu/chat", feishuBotHandler.HandleChatProxy)

	// Feishu webhook (can also be called directly if configured)
	mux.HandleFunc("POST /api/feishu/webhook", feishuBotHandler.HandleWebhook)

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
	"https://chat.jingao.club":    true,
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

type chatPageData struct {
	GatewayURL     string
	UserName       string
	AuthToken      string
	OpenClawToken  string
	OpenClawWSPort int
	OpenClawVncURL string
	PostHogKey     string
	PostHogHost    string
	CacheBust      string
}

func loginPageHandler(tpl *template.Template) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tpl.Execute(w, nil); err != nil {
			log.Error().Err(err).Msg("render login page")
			http.Error(w, "failed to render login page", http.StatusInternalServerError)
		}
	}
}

func chatPageHandler(s *store.Store, cfg *config.Config, tpl *template.Template, cacheBust string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}

		authToken := auth.GetToken(r.Context())
		if authToken == "" {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}

		openclawToken := ""
		openclawWSPort := 0
		vncPort := 0
		if info, err := s.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeOpenClaw); err == nil {
			openclawToken = info.ContainerToken
			openclawWSPort = info.HostPort
			vncPort = info.VncPort
		}

		gatewayURL := resolveGatewayURL(cfg, r)
		openclawVncURL := ""
		if vncPort > 0 {
			openclawVncURL = gatewayURL + "/vnc/vnc.html"
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tpl.Execute(w, chatPageData{
			GatewayURL:     gatewayURL,
			UserName:       user.Name,
			AuthToken:      authToken,
			OpenClawToken:  openclawToken,
			OpenClawWSPort: openclawWSPort,
			OpenClawVncURL: openclawVncURL,
			PostHogKey:     cfg.PostHog.APIKey,
			PostHogHost:    cfg.PostHog.Endpoint,
			CacheBust:      cacheBust,
		}); err != nil {
			log.Error().Err(err).Str("user_id", user.ID).Msg("render chat page")
			http.Error(w, "failed to render chat page", http.StatusInternalServerError)
		}
	}
}

func resolveGatewayURL(cfg *config.Config, r *http.Request) string {
	if u := strings.TrimRight(strings.TrimSpace(cfg.Server.PublicURL), "/"); u != "" {
		return u
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if xfProto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); xfProto != "" {
		scheme = strings.TrimSpace(strings.Split(xfProto, ",")[0])
	}
	return strings.TrimRight(fmt.Sprintf("%s://%s", scheme, r.Host), "/")
}

func loadHTMLTemplate(name string, candidates ...string) (*template.Template, error) {
	var lastErr error
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		tpl, err := template.ParseFiles(candidate)
		if err == nil {
			return tpl, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no template paths provided")
	}
	return nil, fmt.Errorf("load %s template: %w", name, lastErr)
}

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

func createSessionHandler(s *store.Store) http.HandlerFunc {
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
		vncPort := allocateVncPort(hostPort)

		if err := s.CreateContainer(r.Context(), user.ID, containerName, containerToken, hostPort, vncPort, store.ContainerTypeOpenClaw); err != nil {
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
			ip, err := ocClient.Provision(containerName, userID, containerToken, hostPort, vncPort)
			if err != nil {
				log.Error().Err(err).Str("container", containerName).Str("user_id", userID).Msg("async openclaw provision failed")
				return
			}

			bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer bgCancel()

			if err := s.UpdateContainer(bgCtx, userID, store.ContainerTypeOpenClaw, containerName, ip, containerToken, hostPort, vncPort); err != nil {
				log.Error().Err(err).Str("container", containerName).Str("user_id", userID).Msg("async openclaw provision: persist failed")
				return
			}

			log.Info().Str("container", containerName).Str("ip", ip).Str("user_id", userID).Msg("async openclaw provision complete")
		}()
	}
}

func userTeamsHandler(s *store.Store, ocClient *ocpkg.Client) http.HandlerFunc {
	type response struct {
		Installed        string                  `json:"installed"`
		ActiveSessionKey string                  `json:"activeSessionKey"`
		Available        []ocpkg.TemplateSummary `json:"available"`
		Profiles         []ocpkg.ProfileSummary  `json:"profiles"`
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

		profiles := ocClient.ListProfilesMerged(user.ID)
		if profiles == nil {
			profiles = []ocpkg.ProfileSummary{}
		}

		writeJSON(w, http.StatusOK, response{
			Installed:        installed,
			ActiveSessionKey: activeSessionKey,
			Available:        available,
			Profiles:         profiles,
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

		// Determine allowed paths based on HTTP method
		upstreamPath, logicalPath := buildJaMOSSProxyPaths(r.URL.Path)
		if r.Method == http.MethodGet {
			if !isAllowedJaMOSSReadPath(logicalPath) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "jamoss path not allowed"})
				return
			}
		} else {
			if !isAllowedJaMOSSWritePath(logicalPath) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "jamoss write path not allowed"})
				return
			}
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
	case strings.HasPrefix(p, "/stats"):
		return true
	case p == "/health":
		return true
	case strings.HasPrefix(p, "/events"):
		return true
	case strings.HasPrefix(p, "/space/"):
		return true
	case strings.HasPrefix(p, "/config/"):
		return true
	default:
		return false
	}
}

func isAllowedJaMOSSWritePath(p string) bool {
	switch {
	case strings.HasPrefix(p, "/admin/tasks"):
		return true
	case strings.HasPrefix(p, "/tasks"):
		return true
	case strings.HasPrefix(p, "/admin/sub-tasks"):
		return true
	case strings.HasPrefix(p, "/sub-tasks"):
		return true
	case strings.HasPrefix(p, "/logs"):
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

// ── Profile CRUD handlers (user-scoped) ──────────────────────

func userListProfilesHandler(s *store.Store, ocClient *ocpkg.Client) http.HandlerFunc {
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
		profiles := ocClient.ListProfilesMerged(user.ID)
		writeJSON(w, http.StatusOK, profiles)
	}
}

func userGetProfileHandler(ocClient *ocpkg.Client) http.HandlerFunc {
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
		name := r.PathValue("name")
		// Try user profile first, fall back to system profile
		detail, err := ocClient.UserGetProfileDetail(user.ID, name)
		if err != nil {
			if errors.Is(err, ocpkg.ErrProfileNotFound) {
				// Try system profile
				detail, err = ocpkg.GetProfileDetail(name)
				if err != nil {
					if errors.Is(err, ocpkg.ErrProfileNotFound) {
						writeJSON(w, http.StatusNotFound, map[string]string{"error": "profile not found"})
						return
					}
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
			} else {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
		}
		writeJSON(w, http.StatusOK, detail)
	}
}

func userCreateProfileHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

		var detail ocpkg.ProfileDetail
		if err := json.NewDecoder(r.Body).Decode(&detail); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		detail.Name = strings.TrimSpace(detail.Name)
		if detail.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
			return
		}

		// Check if user profile already exists
		if _, err := ocClient.UserGetProfileDetail(user.ID, detail.Name); err == nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "profile already exists"})
			return
		}

		if err := ocClient.UserSaveProfile(user.ID, &detail); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "profile_create", "profile", detail.Name, r.RemoteAddr)
		go propagateToUserContainer(s, ocClient, user.ID)
		writeJSON(w, http.StatusCreated, map[string]string{"name": detail.Name, "status": "created"})
	}
}

func userUpdateProfileHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

		name := r.PathValue("name")
		var detail ocpkg.ProfileDetail
		if err := json.NewDecoder(r.Body).Decode(&detail); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		detail.Name = name

		// Save (create or overwrite) the user profile
		if err := ocClient.UserSaveProfile(user.ID, &detail); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "profile_update", "profile", name, r.RemoteAddr)
		go propagateToUserContainer(s, ocClient, user.ID)
		writeJSON(w, http.StatusOK, map[string]string{"name": name, "status": "updated"})
	}
}

func userDeleteProfileHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

		name := r.PathValue("name")
		if err := ocClient.UserDeleteProfile(user.ID, name); err != nil {
			if errors.Is(err, ocpkg.ErrProfileNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "profile not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "profile_delete", "profile", name, r.RemoteAddr)
		go propagateToUserContainer(s, ocClient, user.ID)
		writeJSON(w, http.StatusOK, map[string]string{"name": name, "status": "deleted"})
	}
}

// ── Template CRUD handlers ───────────────────────────────────

func listTemplatesAdminHandler(ocClient *ocpkg.Client) http.HandlerFunc {
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
			templates = []ocpkg.TemplateSummary{}
		}
		writeJSON(w, http.StatusOK, templates)
	}
}

func getTemplateHandler(ocClient *ocpkg.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ocClient == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "openclaw backend not configured"})
			return
		}
		name := r.PathValue("name")
		detail, err := ocClient.GetTemplateDetail(name)
		if err != nil {
			if errors.Is(err, ocpkg.ErrTemplateNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "template not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, detail)
	}
}

func createTemplateHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

		var detail ocpkg.TemplateDetail
		if err := json.NewDecoder(r.Body).Decode(&detail); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		detail.Name = strings.TrimSpace(detail.Name)
		if detail.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
			return
		}

		if _, err := ocClient.GetTemplateDetail(detail.Name); err == nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "template already exists"})
			return
		}

		if err := ocClient.SaveTemplate(&detail); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "template_create", "template", detail.Name, r.RemoteAddr)
		go propagateToAllOpenClawContainers(s, ocClient)
		writeJSON(w, http.StatusCreated, map[string]string{"name": detail.Name, "status": "created"})
	}
}

func updateTemplateHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

		name := r.PathValue("name")
		var detail ocpkg.TemplateDetail
		if err := json.NewDecoder(r.Body).Decode(&detail); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}
		detail.Name = name

		if _, err := ocClient.GetTemplateDetail(name); err != nil {
			if errors.Is(err, ocpkg.ErrTemplateNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "template not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := ocClient.SaveTemplate(&detail); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "template_update", "template", name, r.RemoteAddr)
		go propagateTemplateToContainers(s, ocClient, name)
		writeJSON(w, http.StatusOK, map[string]string{"name": name, "status": "updated"})
	}
}

func deleteTemplateHandler(s *store.Store, ocClient *ocpkg.Client, al *audit.Logger) http.HandlerFunc {
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

		name := r.PathValue("name")
		if err := ocClient.DeleteTemplate(name); err != nil {
			if errors.Is(err, ocpkg.ErrTemplateNotFound) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "template not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		al.Log(user.ID, "template_delete", "template", name, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"name": name, "status": "deleted"})
	}
}

// ── Propagation helpers ──────────────────────────────────────

func propagateToUserContainer(s *store.Store, ocClient *ocpkg.Client, userID string) {
	ctx := context.Background()
	info, err := s.GetContainerInfo(ctx, userID, store.ContainerTypeOpenClaw)
	if err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("propagate to user: container not found")
		return
	}
	if info.Status != "running" {
		return
	}
	if _, err := ocClient.SyncConfig(ctx, info); err != nil {
		log.Warn().Err(err).Str("container", info.ContainerName).Msg("propagate to user: sync config failed")
	}
	if _, err := ocClient.DeployProfiles(info.ContainerName); err != nil {
		log.Warn().Err(err).Str("container", info.ContainerName).Msg("propagate to user: deploy profiles failed")
	}
	if _, err := ocClient.DeployUserProfiles(info.ContainerName, userID); err != nil {
		log.Warn().Err(err).Str("container", info.ContainerName).Msg("propagate to user: deploy user profiles failed")
	}
}

func propagateToAllOpenClawContainers(s *store.Store, ocClient *ocpkg.Client) {
	ctx := context.Background()
	containers, err := s.ListContainersByType(ctx, store.ContainerTypeOpenClaw)
	if err != nil {
		log.Error().Err(err).Msg("propagate: list containers failed")
		return
	}
	for _, info := range containers {
		if info.Status != "running" {
			continue
		}
		if _, err := ocClient.SyncConfig(ctx, info); err != nil {
			log.Warn().Err(err).Str("container", info.ContainerName).Msg("propagate: sync config failed")
		}
		if _, err := ocClient.DeployProfiles(info.ContainerName); err != nil {
			log.Warn().Err(err).Str("container", info.ContainerName).Msg("propagate: deploy profiles failed")
		}
	}
}

func propagateTemplateToContainers(s *store.Store, ocClient *ocpkg.Client, templateName string) {
	ctx := context.Background()
	containers, err := s.ListContainersByType(ctx, store.ContainerTypeOpenClaw)
	if err != nil {
		log.Error().Err(err).Msg("propagate template: list containers failed")
		return
	}
	for _, info := range containers {
		if info.Status != "running" {
			continue
		}
		installed, _ := s.GetContainerTemplate(ctx, info.UserID, store.ContainerTypeOpenClaw)
		if installed != templateName {
			continue
		}
		if _, err := ocClient.InstallTemplate(ctx, info, templateName); err != nil {
			log.Warn().Err(err).Str("container", info.ContainerName).Str("template", templateName).Msg("propagate template: install failed")
		}
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

func allocateVncPort(ocPort int) int {
	return ocPort + 1000 // OC=18823 → VNC=19823
}

// ── VNC reverse proxy ────────────────────────────────────────

func vncProxyHandler(s *store.Store, hostIP string) http.HandlerFunc {
	const vncPort = 6080 // noVNC websockify port inside the VM
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		info, err := s.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeOpenClaw)
		if err != nil || info.ContainerIP == "" {
			http.Error(w, "VNC not available", http.StatusServiceUnavailable)
			return
		}

		// Use the VM's bridge IP directly (port 6080 is noVNC inside the VM)
		vmIP := info.ContainerIP

		targetPath := strings.TrimPrefix(r.URL.Path, "/vnc")
		if targetPath == "" {
			targetPath = "/"
		}

		// WebSocket upgrade for VNC stream (noVNC → websockify)
		if isWebSocketUpgrade(r) {
			proxyVncWebSocket(w, r, vmIP, vncPort, targetPath)
			return
		}

		// Regular HTTP reverse proxy for noVNC static files
		targetURL, _ := url.Parse(fmt.Sprintf("http://%s:%d", vmIP, vncPort))
		proxy := httputil.NewSingleHostReverseProxy(targetURL)
		originalDirector := proxy.Director
		proxy.Director = func(req *http.Request) {
			originalDirector(req)
			req.URL.Path = targetPath
			req.URL.RawQuery = r.URL.RawQuery
		}
		proxy.ServeHTTP(w, r)
	}
}

// vncWebsockifyHandler proxies the /websockify WebSocket path that noVNC uses internally.
func vncWebsockifyHandler(s *store.Store) http.HandlerFunc {
	const vncPort = 6080
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		info, err := s.GetContainerInfo(r.Context(), user.ID, store.ContainerTypeOpenClaw)
		if err != nil || info.ContainerIP == "" {
			http.Error(w, "VNC not available", http.StatusServiceUnavailable)
			return
		}
		proxyVncWebSocket(w, r, info.ContainerIP, vncPort, "/websockify")
	}
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func proxyVncWebSocket(w http.ResponseWriter, r *http.Request, hostIP string, port int, path string) {
	targetURL := fmt.Sprintf("ws://%s:%d%s", hostIP, port, path)
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	headers := http.Header{}
	if v := r.Header.Get("Sec-WebSocket-Protocol"); v != "" {
		headers.Set("Sec-WebSocket-Protocol", v)
	}

	backConn, _, err := dialer.Dial(targetURL, headers)
	if err != nil {
		log.Warn().Err(err).Str("target", targetURL).Msg("vnc ws proxy: dial failed")
		http.Error(w, "VNC backend unavailable", http.StatusBadGateway)
		return
	}
	defer backConn.Close()

	upgrader := websocket.Upgrader{
		CheckOrigin:  func(r *http.Request) bool { return true },
		Subprotocols: websocket.Subprotocols(r),
	}
	frontConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Warn().Err(err).Msg("vnc ws proxy: upgrade failed")
		return
	}
	defer frontConn.Close()

	// Bidirectional relay
	done := make(chan struct{}, 2)
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, msg, err := backConn.ReadMessage()
			if err != nil {
				return
			}
			if err := frontConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, msg, err := frontConn.ReadMessage()
			if err != nil {
				return
			}
			if err := backConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()
	<-done
}

func isTerminal() bool {
	fi, err := os.Stderr.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}
