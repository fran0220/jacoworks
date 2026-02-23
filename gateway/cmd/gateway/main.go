package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"

	"github.com/fran0220/jacoworks/gateway/internal/audit"
	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/config"
	"github.com/fran0220/jacoworks/gateway/internal/lxd"
	"github.com/fran0220/jacoworks/gateway/internal/proxy"
	"github.com/fran0220/jacoworks/gateway/internal/user"
)

func main() {
	configPath := flag.String("config", "gateway.yaml", "path to config file")
	flag.Parse()

	// Initialize zerolog
	zerolog.TimeFieldFormat = zerolog.TimeFormatUnix
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
		With().Timestamp().Caller().Logger()

	// Load config
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal().Err(err).Msg("load config")
	}
	log.Info().Str("addr", cfg.Addr()).Msg("config loaded")

	// Initialize SQLite
	if err := os.MkdirAll("data", 0755); err != nil {
		log.Fatal().Err(err).Msg("create data dir")
	}

	userStore, err := user.NewStore(cfg.Database.Path)
	if err != nil {
		log.Fatal().Err(err).Msg("init user store")
	}
	defer userStore.Close()

	// Open a shared DB connection for audit
	db, err := sql.Open("sqlite", cfg.Database.Path)
	if err != nil {
		log.Fatal().Err(err).Msg("open audit db")
	}
	defer db.Close()

	auditLogger, err := audit.NewLogger(db)
	if err != nil {
		log.Fatal().Err(err).Msg("init audit logger")
	}

	// Initialize LXD client
	lxdClient := lxd.NewSSHClient(
		cfg.LXD.SSHTarget,
		cfg.LXD.Template,
		cfg.LXD.Network,
		cfg.LXD.OpenClawPort,
	)

	// Initialize freezer (idle containers → frozen after 30 min)
	freezer := lxd.NewFreezer(lxdClient, 30*time.Minute, 5*time.Minute)
	freezer.Start()
	defer freezer.Stop()

	// Initialize handlers
	authMiddleware := auth.NewMiddleware(cfg.Auth.JWTSecret, cfg.Auth.AdminToken)
	proxyHandler := proxy.NewHandler(userStore, lxdClient, freezer, cfg.LXD.OpenClawPort)

	// Build router
	mux := http.NewServeMux()

	// Public: login
	mux.HandleFunc("POST /api/auth/login", loginHandler(userStore, auditLogger, cfg.Auth.JWTSecret))

	// Authenticated: user info
	mux.Handle("GET /api/users/me", authMiddleware.Authenticate(http.HandlerFunc(meHandler)))

	// Authenticated: chat proxy (core)
	mux.Handle("POST /v1/chat/completions", authMiddleware.Authenticate(http.HandlerFunc(proxyHandler.ChatCompletions)))

	// Admin: container management
	mux.Handle("GET /api/admin/containers", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(listContainersHandler(lxdClient)))))
	mux.Handle("POST /api/admin/containers/{id}/start", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(startContainerHandler(lxdClient, auditLogger)))))
	mux.Handle("POST /api/admin/containers/{id}/stop", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(stopContainerHandler(lxdClient, auditLogger)))))

	// Admin: user management
	mux.Handle("POST /api/admin/users", authMiddleware.Authenticate(authMiddleware.RequireAdmin(http.HandlerFunc(createUserHandler(userStore, lxdClient, auditLogger, cfg)))))

	// Health check
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	server := &http.Server{
		Addr:         cfg.Addr(),
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // No timeout for SSE streaming
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
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

// --- Handlers ---

func loginHandler(store *user.Store, al *audit.Logger, jwtSecret string) http.HandlerFunc {
	type loginRequest struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	type loginResponse struct {
		Token string     `json:"token"`
		User  *user.User `json:"user"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		u, err := store.GetByUsername(req.Username)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
			al.Log(u.ID, "login_failed", "bad password", r.RemoteAddr)
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
			return
		}

		claims := auth.UserClaims{
			UserID:   u.ID,
			Username: u.Username,
			Role:     u.Role,
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(time.Now()),
			},
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		tokenStr, err := token.SignedString([]byte(jwtSecret))
		if err != nil {
			log.Error().Err(err).Msg("sign JWT")
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
			return
		}

		al.Log(u.ID, "login", "success", r.RemoteAddr)
		writeJSON(w, http.StatusOK, loginResponse{Token: tokenStr, User: u})
	}
}

func meHandler(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetUser(r.Context())
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user_id":  claims.UserID,
		"username": claims.Username,
		"role":     claims.Role,
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
		claims := auth.GetUser(r.Context())

		if err := client.Start(id); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}

		al.Log(claims.UserID, "container_start", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"status": "started", "container": id})
	}
}

func stopContainerHandler(client *lxd.SSHClient, al *audit.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		claims := auth.GetUser(r.Context())

		if err := client.Stop(id); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
			return
		}

		al.Log(claims.UserID, "container_stop", id, r.RemoteAddr)
		writeJSON(w, http.StatusOK, map[string]string{"status": "stopped", "container": id})
	}
}

func createUserHandler(store *user.Store, lxdClient *lxd.SSHClient, al *audit.Logger, cfg *config.Config) http.HandlerFunc {
	type createRequest struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}

	return func(w http.ResponseWriter, r *http.Request) {
		var req createRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
			return
		}

		if req.Username == "" || req.Password == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username and password required"})
			return
		}

		if req.Role == "" {
			req.Role = "user"
		}

		claims := auth.GetUser(r.Context())

		// Create user in DB (generates container_token)
		u, err := store.CreateUser(req.Username, req.Password, req.Role)
		if err != nil {
			log.Error().Err(err).Str("username", req.Username).Msg("create user failed")
			writeJSON(w, http.StatusConflict, map[string]string{"error": "user already exists or creation failed"})
			return
		}

		// Get container token from DB
		info, _ := store.GetContainerInfo(u.ID)

		// Provision LXD container (async-safe: if it fails, user can retry)
		containerName := "oc-" + req.Username
		envVars := map[string]string{
			"LLM_PROXY_URL": cfg.LLM.ProxyURL,
			"LLM_PROXY_KEY": cfg.LLM.ProxyKey,
		}

		ip, err := lxdClient.ProvisionContainer(containerName, info.ContainerToken, envVars)
		if err != nil {
			log.Error().Err(err).Str("container", containerName).Msg("provision container failed")
			// User created but container failed — admin can retry
			al.Log(claims.UserID, "create_user", fmt.Sprintf("user %s created, container provision FAILED: %v", u.Username, err), r.RemoteAddr)
			writeJSON(w, http.StatusCreated, map[string]interface{}{
				"user":    u,
				"warning": "container provisioning failed, admin can retry",
			})
			return
		}

		// Update container IP in DB
		store.UpdateContainer(u.ID, containerName, ip, info.ContainerToken)
		u.ContainerIP = ip
		u.ContainerName = containerName

		al.Log(claims.UserID, "create_user", fmt.Sprintf("created user %s (id=%d) with container %s (%s)", u.Username, u.ID, containerName, ip), r.RemoteAddr)
		writeJSON(w, http.StatusCreated, u)
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
