package auth

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/markbates/goth"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type Handlers struct {
	store      *store.Store
	sessionTTL time.Duration
}

func NewHandlers(s *store.Store, sessionTTLHours int) *Handlers {
	if sessionTTLHours <= 0 {
		sessionTTLHours = 168 // 7 days
	}
	return &Handlers{
		store:      s,
		sessionTTL: time.Duration(sessionTTLHours) * time.Hour,
	}
}

// --- OAuth state management (server-side, no cookie dependency) ---

type oauthStateData struct {
	SessionData string
	Redirect    string
	ExpiresAt   time.Time
}

var oauthStates sync.Map

func init() {
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			now := time.Now()
			oauthStates.Range(func(key, value interface{}) bool {
				if value.(*oauthStateData).ExpiresAt.Before(now) {
					oauthStates.Delete(key)
				}
				return true
			})
		}
	}()
}

// --- Handlers ---

// Login handles username/email + password login.
// POST /api/auth/login {username, password} — username 支持用户名或邮箱
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username and password required"})
		return
	}

	// Auto-detect: contains '@' → lookup by email, otherwise by name
	var user *store.User
	var err error
	if strings.Contains(req.Username, "@") {
		user, err = h.store.GetUserByEmail(r.Context(), req.Username)
	} else {
		user, err = h.store.GetUserByName(r.Context(), req.Username)
	}
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	if user.PasswordHash == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "此账户使用 SSO 登录"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid credentials"})
		return
	}

	token, err := generateToken(32)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	if err := h.store.CreateAuthSession(r.Context(), token, user.ID, h.sessionTTL, r.RemoteAddr, r.UserAgent()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	log.Info().Str("user_id", user.ID).Str("name", user.Name).Msg("user logged in")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user":  userResponse(user),
	})
}

// Activate handles activation code registration.
// POST /api/auth/activate {code, username, password}
func (h *Handlers) Activate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code     string `json:"code"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}
	if req.Code == "" || req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "code, username, password required"})
		return
	}

	invite, err := h.store.ValidateInviteCode(r.Context(), req.Code)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "激活码无效或已过期"})
		return
	}

	email := req.Username + "@jacoworks.local"
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	user, err := h.store.CreateUser(r.Context(), req.Username, email, string(hash), invite.Role)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "用户创建失败，用户名可能已存在"})
		return
	}

	if err := h.store.UseInviteCode(r.Context(), req.Code, user.ID); err != nil {
		log.Error().Err(err).Str("code", req.Code).Msg("failed to mark invite code used")
	}

	token, err := generateToken(32)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	if err := h.store.CreateAuthSession(r.Context(), token, user.ID, h.sessionTTL, r.RemoteAddr, r.UserAgent()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	log.Info().Str("user_id", user.ID).Str("username", req.Username).Msg("user activated")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"token": token,
		"user":  userResponse(user),
	})
}

// Logout invalidates the current session.
// POST /api/auth/logout (requires Bearer token)
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	token := extractBearerToken(r)
	if token != "" {
		h.store.DeleteAuthSession(r.Context(), token)
	}
	w.WriteHeader(http.StatusNoContent)
}

// FeishuBegin starts the Feishu OAuth2 flow.
// GET /api/auth/feishu?redirect=<frontend_url>
func (h *Handlers) FeishuBegin(w http.ResponseWriter, r *http.Request) {
	provider, err := goth.GetProvider("feishu")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "飞书 SSO 未配置"})
		return
	}

	redirect := r.URL.Query().Get("redirect")
	if redirect == "" {
		redirect = "http://localhost:1420"
	}

	state, err := generateToken(16)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	sess, err := provider.BeginAuth(state)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to begin auth"})
		return
	}

	authURL, err := sess.GetAuthURL()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get auth URL"})
		return
	}

	oauthStates.Store(state, &oauthStateData{
		SessionData: sess.Marshal(),
		Redirect:    redirect,
		ExpiresAt:   time.Now().Add(10 * time.Minute),
	})

	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// FeishuCallback handles the Feishu OAuth2 callback.
// GET /api/auth/feishu/callback?code=xxx&state=xxx
func (h *Handlers) FeishuCallback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	stored, ok := oauthStates.LoadAndDelete(state)
	if !ok {
		http.Error(w, "invalid or expired state", http.StatusBadRequest)
		return
	}

	stateData := stored.(*oauthStateData)
	if stateData.ExpiresAt.Before(time.Now()) {
		redirectWithError(w, r, stateData.Redirect, "state_expired")
		return
	}

	provider, err := goth.GetProvider("feishu")
	if err != nil {
		redirectWithError(w, r, stateData.Redirect, "provider_not_found")
		return
	}

	sess, err := provider.UnmarshalSession(stateData.SessionData)
	if err != nil {
		redirectWithError(w, r, stateData.Redirect, "session_error")
		return
	}

	_, err = sess.Authorize(provider, r.URL.Query())
	if err != nil {
		log.Error().Err(err).Msg("feishu authorize failed")
		redirectWithError(w, r, stateData.Redirect, "authorize_failed")
		return
	}

	gothUser, err := provider.FetchUser(sess)
	if err != nil {
		log.Error().Err(err).Msg("feishu fetch user failed")
		redirectWithError(w, r, stateData.Redirect, "fetch_user_failed")
		return
	}

	user, err := h.store.FindOrCreateFeishuUser(r.Context(), gothUser.UserID, gothUser.Name, gothUser.Email)
	if err != nil {
		log.Error().Err(err).Msg("find or create feishu user failed")
		redirectWithError(w, r, stateData.Redirect, "create_user_failed")
		return
	}

	token, err := generateToken(32)
	if err != nil {
		redirectWithError(w, r, stateData.Redirect, "internal_error")
		return
	}

	if err := h.store.CreateAuthSession(r.Context(), token, user.ID, h.sessionTTL, r.RemoteAddr, r.UserAgent()); err != nil {
		redirectWithError(w, r, stateData.Redirect, "session_error")
		return
	}

	log.Info().Str("user_id", user.ID).Str("feishu_id", gothUser.UserID).Msg("feishu user logged in")

	redirectURL := stateData.Redirect + "?token=" + url.QueryEscape(token)
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// --- Helpers ---

func userResponse(u *store.User) map[string]string {
	return map[string]string{
		"id":    u.ID,
		"name":  u.Name,
		"email": u.Email,
		"role":  u.Role,
	}
}

func redirectWithError(w http.ResponseWriter, r *http.Request, redirectURL, errCode string) {
	http.Redirect(w, r, redirectURL+"?error="+errCode, http.StatusTemporaryRedirect)
}

func generateToken(bytes int) (string, error) {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
