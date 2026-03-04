package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

type contextKey string

const UserContextKey contextKey = "user"

type UserInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

type middlewareStore interface {
	ValidateAuthSession(ctx context.Context, token string) (*store.User, error)
	GetUserByContainerToken(ctx context.Context, token string) (*store.User, error)
}

type Middleware struct {
	store      middlewareStore
	adminToken string
}

func NewMiddleware(s *store.Store, adminToken string) *Middleware {
	return NewMiddlewareWithStore(s, adminToken)
}

func NewMiddlewareWithStore(s middlewareStore, adminToken string) *Middleware {
	return &Middleware{
		store:      s,
		adminToken: adminToken,
	}
}

func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractBearerToken(r)
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing auth"})
			return
		}

		// Admin token passthrough
		if m.adminToken != "" && token == m.adminToken {
			ctx := context.WithValue(r.Context(), UserContextKey, &UserInfo{
				ID: "admin", Name: "admin", Email: "admin@jacoworks.local", Role: "admin",
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		if m.store == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
			return
		}

		// Validate session token via store
		user, err := m.store.ValidateAuthSession(r.Context(), token)
		if err != nil {
			// Fallback: try container token (for OpenClaw agent API calls)
			cUser, cerr := m.store.GetUserByContainerToken(r.Context(), token)
			if cerr != nil {
				log.Debug().Err(err).Msg("session validation failed")
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid session"})
				return
			}
			user = cUser
		}

		ctx := context.WithValue(r.Context(), UserContextKey, &UserInfo{
			ID:    user.ID,
			Name:  user.Name,
			Email: user.Email,
			Role:  user.Role,
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (m *Middleware) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUser(r.Context())
		if user == nil || user.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func GetUser(ctx context.Context) *UserInfo {
	info, _ := ctx.Value(UserContextKey).(*UserInfo)
	return info
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	// Fallback: query param for WebSocket connections (browsers can't set headers on WS)
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
