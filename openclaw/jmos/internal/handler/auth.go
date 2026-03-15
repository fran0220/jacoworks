package handler

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

type ctxKeyAgent ctxKey

const ctxKeyCurrentAgent ctxKeyAgent = 0

func AgentFromContext(ctx context.Context) *model.Agent {
	if a, ok := ctx.Value(ctxKeyCurrentAgent).(*model.Agent); ok {
		return a
	}
	return nil
}

func AgentAuth(db *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if !strings.HasPrefix(auth, "Bearer ") {
				http.Error(w, `{"error":"missing or invalid Authorization header"}`, http.StatusUnauthorized)
				return
			}
			apiKey := strings.TrimPrefix(auth, "Bearer ")

			var agent model.Agent
			err := db.QueryRowContext(r.Context(),
				`SELECT id, name, role, status FROM agent WHERE api_key = ?`, apiKey,
			).Scan(&agent.ID, &agent.Name, &agent.Role, &agent.Status)
			if err != nil {
				http.Error(w, `{"error":"invalid api key"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), ctxKeyCurrentAgent, &agent)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func AdminAuth(adminPassword string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := r.Header.Get("X-Admin-Token")
			if token == "" || token != adminPassword {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			agent := AgentFromContext(r.Context())
			if agent == nil {
				http.Error(w, `{"error":"agent authentication required"}`, http.StatusUnauthorized)
				return
			}
			if !allowed[agent.Role] {
				http.Error(w, `{"error":"insufficient role"}`, http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
