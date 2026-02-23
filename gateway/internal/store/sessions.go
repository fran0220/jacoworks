package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type ChatSession struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Title         string          `json:"title"`
	Type          string          `json:"type"`
	Model         string          `json:"model"`
	WorkspacePath string          `json:"workspace_path"`
	Messages      json.RawMessage `json:"messages"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type SessionSummary struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Type         string    `json:"type"`
	MessageCount int       `json:"message_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (s *Store) ListSessions(ctx context.Context, userID string) ([]SessionSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, title, type, jsonb_array_length(messages), created_at, updated_at
		 FROM chat_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []SessionSummary
	for rows.Next() {
		var ss SessionSummary
		if err := rows.Scan(&ss.ID, &ss.Title, &ss.Type, &ss.MessageCount, &ss.CreatedAt, &ss.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, ss)
	}
	return sessions, nil
}

func (s *Store) GetSession(ctx context.Context, userID, sessionID string) (*ChatSession, error) {
	sess := &ChatSession{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, title, type, model, workspace_path, messages, created_at, updated_at
		 FROM chat_sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	).Scan(&sess.ID, &sess.UserID, &sess.Title, &sess.Type, &sess.Model, &sess.WorkspacePath, &sess.Messages, &sess.CreatedAt, &sess.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return sess, nil
}

func (s *Store) CreateSession(ctx context.Context, userID, sessionType, workspacePath string) (*ChatSession, error) {
	if sessionType == "" {
		sessionType = "chat"
	}

	sess := &ChatSession{}
	err := s.pool.QueryRow(ctx,
		`INSERT INTO chat_sessions (user_id, type, workspace_path)
		 VALUES ($1, $2, $3)
		 RETURNING id, user_id, title, type, model, workspace_path, messages, created_at, updated_at`,
		userID, sessionType, workspacePath,
	).Scan(&sess.ID, &sess.UserID, &sess.Title, &sess.Type, &sess.Model, &sess.WorkspacePath, &sess.Messages, &sess.CreatedAt, &sess.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	return sess, nil
}

func (s *Store) UpdateSession(ctx context.Context, userID, sessionID, title, messages string) (*ChatSession, error) {
	if title != "" && messages != "" {
		_, err := s.pool.Exec(ctx,
			`UPDATE chat_sessions SET title = $1, messages = $2::jsonb WHERE id = $3 AND user_id = $4`,
			title, messages, sessionID, userID,
		)
		if err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	} else if title != "" {
		_, err := s.pool.Exec(ctx,
			`UPDATE chat_sessions SET title = $1 WHERE id = $2 AND user_id = $3`,
			title, sessionID, userID,
		)
		if err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	} else if messages != "" {
		_, err := s.pool.Exec(ctx,
			`UPDATE chat_sessions SET messages = $1::jsonb WHERE id = $2 AND user_id = $3`,
			messages, sessionID, userID,
		)
		if err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	}

	return s.GetSession(ctx, userID, sessionID)
}

func (s *Store) DeleteSession(ctx context.Context, userID, sessionID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2`,
		sessionID, userID,
	)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("session not found")
	}
	return nil
}
