package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/markbates/goth"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/auth/feishu"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/cowork"
	"github.com/fran0220/jacoworks/gateway/internal/feishubot"
	"github.com/fran0220/jacoworks/gateway/internal/lxd"
	"github.com/fran0220/jacoworks/gateway/internal/openclaw"
	"github.com/fran0220/jacoworks/gateway/internal/proxy"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

func main() {
	configPath := "gateway.yaml"
	if len(os.Args) > 1 {
		configPath = os.Args[1]
	}

	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
		With().Timestamp().Caller().Logger()

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
			case "feishu_client_id":
				cfg.Auth.FeishuClientID = setting.Value
			case "feishu_client_secret":
				cfg.Auth.FeishuClientSecret = setting.Value
			case "admin_token":
				cfg.Auth.AdminToken = setting.Value
			}
			}
			cfg.UpdateLLM(llm)
		log.Info().Msg("loaded settings from database")
	}

	auditLogger := audit.NewLogger(s.Pool())

	// Initialize LXD client
	lxdClient := lxd.NewSSHClient(
		cfg.LXD.SSHTarget,
		cfg.LXD.Template,
		cfg.LXD.Network,
		cfg.LXD.OpenClawPort,
	)

	freezer := lxd.NewFreezer(lxdClient, 30*time.Minute, 5*time.Minute)
	freezer.Start()
	defer freezer.Stop()

	// Pull memory files from container before freezing
	freezer.SetOnBeforeFreeze(func(containerName string) {
		ctx := context.Background()
		userID, err := s.GetUserIDByContainerName(ctx, containerName)
		if err != nil {
			log.Error().Err(err).Str("container", containerName).Msg("freeze: lookup user failed")
			return
		}
		files, err := lxdClient.PullMemoryFiles(containerName)
		if err != nil {
			log.Error().Err(err).Str("container", containerName).Msg("freeze: pull memory failed")
			return
		}
		for filePath, content := range files {
			ck := store.ContentChecksum(content)
			if err := s.UpsertMemoryFile(ctx, userID, filePath, content, ck); err != nil {
				log.Error().Err(err).Str("container", containerName).Str("file", filePath).Msg("freeze: save memory failed")
			}
		}
		if len(files) > 0 {
			log.Info().Str("container", containerName).Int("files", len(files)).Msg("freeze: memory pulled")
		}
	})
	freezer.SetOnAfterFreeze(func(containerName string) {
		if err := s.UpdateContainerStatusByName(context.Background(), containerName, "frozen"); err != nil {
			log.Error().Err(err).Str("container", containerName).Msg("freeze: update frozen status failed")
		}
	})

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
	proxyHandler := proxy.NewHandler(s, lxdClient, freezer, cfg.LXD.OpenClawPort, cfg.ChatAgent.URL, cfg.ChatAgent.Token)
	coworkHandler := cowork.NewHandler(s, lxdClient)
	wsProxy := openclaw.NewWSProxy(s, lxdClient, freezer, cfg.LXD.OpenClawPort, "data")
	channelPool := openclaw.NewChannelPool(wsProxy, 5*time.Minute, 1024)
	defer channelPool.Close()
	sseHandler := openclaw.NewSSEHandler(channelPool)

	// Initialize Feishu Bot handler (shares ChannelPool with desktop for conversation sync)
	feishuBotClient := feishubot.NewClient(cfg.Auth.FeishuClientID, cfg.Auth.FeishuClientSecret)
	feishuBotHandler := feishubot.NewHandler(feishuBotClient, s, channelPool)

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
	mux.Handle("POST /api/sessions", authMiddleware.Authenticate(http.HandlerFunc(createSessionHandler(s, lxdClient))))
	mux.Handle("GET /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(getSessionHandler(s))))
	mux.Handle("PUT /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(updateSessionHandler(s))))
	mux.Handle("DELETE /api/sessions/{id}", authMiddleware.Authenticate(http.HandlerFunc(deleteSessionHandler(s))))

	// Authenticated: agent config
	mux.Handle("GET /api/agent/config", authMiddleware.Authenticate(http.HandlerFunc(agentConfigHandler(cfg))))

	// Authenticated: memory sync
	mux.Handle("POST /api/memory/sync", authMiddleware.Authenticate(http.HandlerFunc(memorySyncHandler(s))))

	// Authenticated: skills sync
	mux.Handle("POST /api/skills/upload", authMiddleware.Authenticate(http.HandlerFunc(skillsUploadHandler(s))))
	mux.Handle("GET /api/skills/checksum", authMiddleware.Authenticate(http.HandlerFunc(skillsChecksumHandler(s))))

	// Authenticated: cowork
	mux.Handle("GET /api/cowork/container-status", authMiddleware.Authenticate(http.HandlerFunc(containerStatusHandler(s))))
	mux.Handle("POST /api/cowork/provision", authMiddleware.Authenticate(http.HandlerFunc(selfProvisionHandler(s, lxdClient, auditLogger, cfg, wsProxy))))
	mux.Handle("POST /api/cowork/{sid}/upload", authMiddleware.Authenticate(http.HandlerFunc(coworkHandler.Upload)))
	mux.Handle("GET /api/cowork/{sid}/changes", authMiddleware.Authenticate(http.HandlerFunc(coworkHandler.Changes)))
	mux.Handle("GET /api/cowork/{sid}/download", authMiddleware.Authenticate(http.HandlerFunc(coworkHandler.Download)))

	// Authenticated: chat proxy
	mux.Handle("POST /v1/chat/completions", authMiddleware.Authenticate(http.HandlerFunc(proxyHandler.ChatCompletions)))

	// Authenticated: OpenClaw WebSocket proxy
	mux.Handle("GET /ws/openclaw", authMiddleware.Authenticate(wsProxy))
	mux.Handle("GET /api/oc/stream", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.StreamEvents)))
	mux.Handle("POST /api/oc/send", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.SendCommand)))
	mux.Handle("GET /api/oc/status", authMiddleware.Authenticate(http.HandlerFunc(sseHandler.GetStatus)))

	// Admin: container management
	mux.Handle("GET /api/admin/containers", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listContainersHandler(lxdClient)))))
	mux.Handle("POST /api/admin/containers/{id}/start", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(startContainerHandler(lxdClient, s, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/stop", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(stopContainerHandler(lxdClient, s, auditLogger)))))

	// Admin: user management (container provisioning after activation)
	mux.Handle("POST /api/admin/provision", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(provisionContainerHandler(s, lxdClient, auditLogger, cfg, wsProxy)))))

	// Admin: invite codes
	mux.Handle("POST /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(createInviteCodeHandler(s)))))
	mux.Handle("GET /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listInviteCodesHandler(s)))))

	// Admin: settings
	mux.Handle("GET /api/admin/settings", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(getSettingsHandler(s)))))
	mux.Handle("PUT /api/admin/settings", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(updateSettingsHandler(s, cfg, auditLogger, feishuBotClient)))))

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           corsMiddleware(mux),
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
}

// --- CORS ---

var allowedOrigins = map[string]bool{
	"http://localhost:1420":        true,
	"tauri://localhost":            true,  // macOS WebKit
	"https://tauri.localhost":      true,  // Windows WebView2
	"https://jaco.jingao.club":     true,
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

func listContainersHandler(client *lxd.SSHClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		containers, err := client.List()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, containers)
	}
}

func startContainerHandler(client *lxd.SSHClient, s *store.Store, al *audit.Logger) http.HandlerFunc {
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

func stopContainerHandler(client *lxd.SSHClient, s *store.Store, al *audit.Logger) http.HandlerFunc {
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

func provisionContainerHandler(s *store.Store, lxdClient *lxd.SSHClient, al *audit.Logger, cfg *config.Config, wsProxy *openclaw.WSProxy) http.HandlerFunc {
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

		if err := s.CreateContainer(r.Context(), req.UserID, containerName, containerToken); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "container record creation failed"})
			return
		}

		llm := cfg.GetLLM()
		envVars := map[string]string{
			"LLM_PROXY_URL":  llm.ProxyURL,
			"LLM_PROXY_KEY":  llm.ProxyKey,
			"OPENAI_API_KEY": llm.OpenAIAPIKey,
		}
		deviceKey := wsProxy.GetDeviceKeyInfo()
		ip, err := lxdClient.ProvisionContainer(containerName, containerToken, envVars, deviceKey)
		if err != nil {
			log.Error().Err(err).Str("container", containerName).Msg("provision container failed")
			al.Log(admin.ID, "provision_container", "container", containerName, r.RemoteAddr)
			writeJSON(w, http.StatusCreated, map[string]interface{}{
				"user_id":   req.UserID,
				"container": containerName,
				"warning":   "container provisioning failed, admin can retry",
			})
			return
		}

		if err := s.UpdateContainer(r.Context(), req.UserID, containerName, ip, containerToken); err != nil {
			log.Error().Err(err).Str("container", containerName).Str("user_id", req.UserID).Msg("persist provisioned container failed")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "container provisioned but failed to persist state"})
			return
		}
		al.Log(admin.ID, "provision_container", "container", containerName, r.RemoteAddr)
		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"user_id":   req.UserID,
			"container": containerName,
			"ip":        ip,
		})
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

func createSessionHandler(s *store.Store, lxdClient *lxd.SSHClient) http.HandlerFunc {
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

		if req.Type == "cowork" {
			dir := filepath.Join("/data/cowork", user.ID, sess.ID)
			if err := os.MkdirAll(dir, 0755); err != nil {
				log.Warn().Err(err).Str("user_id", user.ID).Str("session_id", sess.ID).Str("dir", dir).Msg("create cowork workspace directory failed")
			}

			info, err := s.GetContainerInfo(r.Context(), user.ID)
			if err != nil {
				log.Warn().Err(err).Str("user_id", user.ID).Str("session_id", sess.ID).Msg("load container info for cowork mount failed")
			} else if info != nil && info.ContainerName != "" {
				device := "cw-" + sess.ID[:12]
				if err := lxdClient.MountDisk(info.ContainerName, device, dir, "/home/agent/cowork"); err != nil {
					log.Warn().Err(err).Str("container", info.ContainerName).Str("session_id", sess.ID).Str("device", device).Msg("mount cowork workspace into container failed")
				}
			}
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
		info, err := s.GetContainerInfo(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"provisioned": false,
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"provisioned":    true,
			"container_name": info.ContainerName,
			"container_ip":   info.ContainerIP,
		})
	}
}

// selfProvisionHandler allows a user to provision their own container for cowork mode.
func selfProvisionHandler(s *store.Store, lxdClient *lxd.SSHClient, al *audit.Logger, cfg *config.Config, wsProxy *openclaw.WSProxy) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		// Check if already provisioned
		info, err := s.GetContainerInfo(r.Context(), user.ID)
		if err == nil && info.ContainerIP != "" {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":         "ready",
				"container_name": info.ContainerName,
			})
			return
		}

		containerToken, err := generateToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate container token"})
			return
		}
		containerName := containerNameForUser(user.ID)

		if err := s.CreateContainer(r.Context(), user.ID, containerName, containerToken); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "container record creation failed"})
			return
		}

		llm := cfg.GetLLM()
		envVars := map[string]string{
			"LLM_PROXY_URL":  llm.ProxyURL,
			"LLM_PROXY_KEY":  llm.ProxyKey,
			"OPENAI_API_KEY": llm.OpenAIAPIKey,
		}
		deviceKey := wsProxy.GetDeviceKeyInfo()
		ip, err := lxdClient.ProvisionContainer(containerName, containerToken, envVars, deviceKey)
		if err != nil {
			log.Error().Err(err).Str("container", containerName).Str("user_id", user.ID).Msg("self-provision failed")
			al.Log(user.ID, "self_provision", "container", containerName, r.RemoteAddr)
			writeJSON(w, http.StatusAccepted, map[string]interface{}{
				"status":         "provisioning",
				"container_name": containerName,
				"warning":        "container provisioning in progress, retry later",
			})
			return
		}

		// Use background context — HTTP request context may already be canceled
		// after the long-running ProvisionContainer call.
		bgCtx, bgCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer bgCancel()
		if err := s.UpdateContainer(bgCtx, user.ID, containerName, ip, containerToken); err != nil {
			log.Error().Err(err).Str("container", containerName).Str("user_id", user.ID).Msg("persist self-provisioned container failed")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "container provisioned but failed to persist state"})
			return
		}
		al.Log(user.ID, "self_provision", "container", containerName, r.RemoteAddr)

		// Push memory + skills to newly provisioned container
		go func() {
			bgCtx := context.Background()
			// Push memory
			memFiles, err := s.GetAllMemoryFiles(bgCtx, user.ID)
			if err == nil && len(memFiles) > 0 {
				fileMap := make(map[string]string, len(memFiles))
				for _, f := range memFiles {
					fileMap[f.FilePath] = f.Content
				}
				if err := lxdClient.PushMemoryFiles(containerName, fileMap); err != nil {
					log.Error().Err(err).Str("container", containerName).Msg("provision: push memory failed")
				}
			}
			// Push skills (system + user)
			for _, owner := range []string{"system", user.ID} {
				skillFiles, err := s.GetSkillFiles(bgCtx, owner)
				if err == nil && len(skillFiles) > 0 {
					fileMap := make(map[string]string, len(skillFiles))
					for _, f := range skillFiles {
						fileMap[f.FilePath] = f.Content
					}
					if err := lxdClient.PushSkillFiles(containerName, fileMap); err != nil {
						log.Error().Err(err).Str("container", containerName).Msg("provision: push skills failed")
					}
				}
			}
		}()

		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"status":         "ready",
			"container_name": containerName,
			"ip":             ip,
		})
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
			"llm_proxy_url":  llm.ProxyURL,
			"llm_proxy_key":  llm.ProxyKey,
			"openai_api_key": llm.OpenAIAPIKey,
			"exa_api_key":    llm.ExaAPIKey,
			"tavily_api_key": llm.TavilyKey,
			"models": []map[string]string{
				{"id": "claude-sonnet-4-6", "provider": "proxy-claude", "label": "Sonnet 4.6"},
				{"id": "claude-opus-4-6", "provider": "proxy-claude", "label": "Opus 4.6"},
				{"id": "claude-haiku-4-5-20251001", "provider": "proxy-claude", "label": "Haiku 4.5"},
				{"id": "gpt-5.3-codex", "provider": "proxy-gpt", "label": "GPT-5.3 Codex"},
				{"id": "gpt-5.2", "provider": "proxy-gpt", "label": "GPT-5.2"},
				{"id": "gemini-3.1-pro-preview", "provider": "proxy-gemini", "label": "Gemini 3.1 Pro"},
				{"id": "gemini-3-flash-preview", "provider": "proxy-gemini", "label": "Gemini 3 Flash"},
				{"id": "grok-4.20-beta", "provider": "proxy-grok", "label": "Grok 4.20"},
				{"id": "grok-4.1-fast", "provider": "proxy-grok", "label": "Grok 4.1 Fast"},
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

func updateSettingsHandler(s *store.Store, cfg *config.Config, al *audit.Logger, feishuBot *feishubot.Client) http.HandlerFunc {
	type updateRequest struct {
		Settings map[string]string `json:"settings"`
	}

	allowedKeys := map[string]bool{
		"llm_proxy_url":        true,
		"llm_proxy_key":        true,
		"openai_api_key":       true,
		"exa_api_key":          true,
		"tavily_api_key":       true,
		"feishu_client_id":     true,
		"feishu_client_secret": true,
		"admin_token":          true,
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

		al.Log(admin.ID, "update_settings", "settings", "", r.RemoteAddr)

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
			storeFiles = append(storeFiles, store.SkillFile{
				FilePath: f.Path,
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

func containerNameForUser(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	// Deterministic 16-hex suffix avoids collisions from truncated IDs.
	return "oc-" + hex.EncodeToString(sum[:8])
}
