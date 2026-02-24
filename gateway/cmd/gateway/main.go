package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
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
	"github.com/fran0220/jacoworks/gateway/internal/lxd"
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

	mux := http.NewServeMux()

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

	// Authenticated: cowork
	mux.Handle("GET /api/cowork/container-status", authMiddleware.Authenticate(http.HandlerFunc(containerStatusHandler(s))))
	mux.Handle("POST /api/cowork/provision", authMiddleware.Authenticate(http.HandlerFunc(selfProvisionHandler(s, lxdClient, auditLogger, cfg))))
	mux.Handle("POST /api/cowork/{sid}/upload", authMiddleware.Authenticate(http.HandlerFunc(coworkHandler.Upload)))
	mux.Handle("GET /api/cowork/{sid}/changes", authMiddleware.Authenticate(http.HandlerFunc(coworkHandler.Changes)))
	mux.Handle("GET /api/cowork/{sid}/download", authMiddleware.Authenticate(http.HandlerFunc(coworkHandler.Download)))

	// Authenticated: chat proxy
	mux.Handle("POST /v1/chat/completions", authMiddleware.Authenticate(http.HandlerFunc(proxyHandler.ChatCompletions)))

	// Admin: container management
	mux.Handle("GET /api/admin/containers", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listContainersHandler(lxdClient)))))
	mux.Handle("POST /api/admin/containers/{id}/start", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(startContainerHandler(lxdClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/stop", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(stopContainerHandler(lxdClient, auditLogger)))))

	// Admin: user management (container provisioning after activation)
	mux.Handle("POST /api/admin/provision", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(provisionContainerHandler(s, lxdClient, auditLogger, cfg)))))

	// Admin: invite codes
	mux.Handle("POST /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(createInviteCodeHandler(s)))))
	mux.Handle("GET /api/admin/invite-codes", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listInviteCodesHandler(s)))))

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	server := &http.Server{
		Addr:         cfg.Addr(),
		Handler:      corsMiddleware(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
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
	"tauri://localhost":            true,
	"http://192.168.31.162:8090":   true,
	"http://api.xiaomao.chat:8090": true,
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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Cowork-Session")
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

func startContainerHandler(client *lxd.SSHClient, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		user := auth.GetUser(r.Context())
		if err := client.Start(id); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		al.Log(user.ID, "container_start", "container", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"status": "started", "container": id})
	}
}

func stopContainerHandler(client *lxd.SSHClient, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		user := auth.GetUser(r.Context())
		if err := client.Stop(id); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}
		al.Log(user.ID, "container_stop", "container", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"status": "stopped", "container": id})
	}
}

func provisionContainerHandler(s *store.Store, lxdClient *lxd.SSHClient, al *audit.Logger, cfg *config.Config) http.HandlerFunc {
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

		containerToken, _ := generateToken()
		containerName := "oc-" + req.Username

		if err := s.CreateContainer(r.Context(), req.UserID, containerName, containerToken); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "container record creation failed"})
			return
		}

		envVars := map[string]string{
			"LLM_PROXY_URL": cfg.LLM.ProxyURL,
			"LLM_PROXY_KEY": cfg.LLM.ProxyKey,
		}
		ip, err := lxdClient.ProvisionContainer(containerName, containerToken, envVars)
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

		s.UpdateContainer(r.Context(), req.UserID, containerName, ip, containerToken)
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
		json.NewDecoder(r.Body).Decode(&req)

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
		json.NewDecoder(r.Body).Decode(&req)

		sess, err := s.CreateSession(r.Context(), user.ID, req.Type, req.WorkspacePath, req.Model)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create session"})
			return
		}

		if req.Type == "cowork" {
			dir := filepath.Join("/data/cowork", user.ID, sess.ID)
			os.MkdirAll(dir, 0755)

			info, _ := s.GetContainerInfo(r.Context(), user.ID)
			if info != nil && info.ContainerName != "" {
				device := "cw-" + sess.ID[:12]
				lxdClient.MountDisk(info.ContainerName, device, dir, "/home/agent/cowork")
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
func selfProvisionHandler(s *store.Store, lxdClient *lxd.SSHClient, al *audit.Logger, cfg *config.Config) http.HandlerFunc {
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

		containerToken, _ := generateToken()
		containerName := "oc-" + user.Name

		if err := s.CreateContainer(r.Context(), user.ID, containerName, containerToken); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "container record creation failed"})
			return
		}

		envVars := map[string]string{
			"LLM_PROXY_URL": cfg.LLM.ProxyURL,
			"LLM_PROXY_KEY": cfg.LLM.ProxyKey,
		}
		ip, err := lxdClient.ProvisionContainer(containerName, containerToken, envVars)
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

		s.UpdateContainer(r.Context(), user.ID, containerName, ip, containerToken)
		al.Log(user.ID, "self_provision", "container", containerName, r.RemoteAddr)
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
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"llm_proxy_url": cfg.LLM.ProxyURL,
			"llm_proxy_key": cfg.LLM.ProxyKey,
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
