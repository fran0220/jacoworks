package user

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

type User struct {
	ID             int64     `json:"id"`
	Username       string    `json:"username"`
	PasswordHash   string    `json:"-"`
	ContainerName  string    `json:"container_name"`
	ContainerIP    string    `json:"container_ip"`
	ContainerToken string    `json:"-"`
	Role           string    `json:"role"`
	CreatedAt      time.Time `json:"created_at"`
}

type ContainerInfo struct {
	ContainerName  string
	ContainerIP    string
	ContainerToken string
}

type Store struct {
	db *sql.DB
}

func NewStore(dbPath string) (*Store, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Enable WAL mode for better concurrency
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return nil, fmt.Errorf("enable WAL: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return s, nil
}

type Session struct {
	ID            string `json:"id"`
	UserID        int64  `json:"user_id"`
	Title         string `json:"title"`
	Messages      string `json:"messages"`
	Type          string `json:"type"`
	WorkspacePath string `json:"workspace_path"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
}

type SessionSummary struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Type         string `json:"type"`
	MessageCount int    `json:"message_count"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			username        TEXT    NOT NULL UNIQUE,
			password_hash   TEXT    NOT NULL,
			container_name  TEXT    NOT NULL DEFAULT '',
			container_ip    TEXT    NOT NULL DEFAULT '',
			container_token TEXT    NOT NULL DEFAULT '',
			role            TEXT    NOT NULL DEFAULT 'user',
			created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE IF NOT EXISTS sessions (
			id             TEXT PRIMARY KEY,
			user_id        INTEGER NOT NULL REFERENCES users(id),
			title          TEXT NOT NULL DEFAULT '新对话',
			messages       TEXT NOT NULL DEFAULT '[]',
			type           TEXT NOT NULL DEFAULT 'chat',
			workspace_path TEXT NOT NULL DEFAULT '',
			created_at     INTEGER NOT NULL,
			updated_at     INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
	`)
	if err != nil {
		return err
	}

	// Migrate existing sessions table: add columns if missing
	s.db.Exec(`ALTER TABLE sessions ADD COLUMN type TEXT NOT NULL DEFAULT 'chat'`)
	s.db.Exec(`ALTER TABLE sessions ADD COLUMN workspace_path TEXT NOT NULL DEFAULT ''`)

	return nil
}

func (s *Store) CreateUser(username, password, role string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	token, err := generateToken()
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	containerName := "oc-" + username

	result, err := s.db.Exec(
		`INSERT INTO users (username, password_hash, container_name, container_token, role) VALUES (?, ?, ?, ?, ?)`,
		username, string(hash), containerName, token, role,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}

	id, _ := result.LastInsertId()
	return &User{
		ID:            id,
		Username:      username,
		ContainerName: containerName,
		Role:          role,
		CreatedAt:     time.Now(),
	}, nil
}

func (s *Store) GetByUsername(username string) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(
		`SELECT id, username, password_hash, container_name, container_ip, container_token, role, created_at FROM users WHERE username = ?`,
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.ContainerName, &u.ContainerIP, &u.ContainerToken, &u.Role, &u.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by username: %w", err)
	}
	return u, nil
}

func (s *Store) GetByID(id int64) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(
		`SELECT id, username, password_hash, container_name, container_ip, container_token, role, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.ContainerName, &u.ContainerIP, &u.ContainerToken, &u.Role, &u.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return u, nil
}

func (s *Store) GetContainerInfo(userID int64) (*ContainerInfo, error) {
	info := &ContainerInfo{}
	err := s.db.QueryRow(
		`SELECT container_name, container_ip, container_token FROM users WHERE id = ?`,
		userID,
	).Scan(&info.ContainerName, &info.ContainerIP, &info.ContainerToken)
	if err != nil {
		return nil, fmt.Errorf("get container info: %w", err)
	}
	return info, nil
}

func (s *Store) UpdateContainerIP(userID int64, ip string) error {
	_, err := s.db.Exec(`UPDATE users SET container_ip = ? WHERE id = ?`, ip, userID)
	return err
}

func (s *Store) UpdateContainer(userID int64, name, ip, token string) error {
	_, err := s.db.Exec(`UPDATE users SET container_name = ?, container_ip = ?, container_token = ? WHERE id = ?`, name, ip, token, userID)
	return err
}

func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(
		`SELECT id, username, password_hash, container_name, container_ip, container_token, role, created_at FROM users ORDER BY id`,
	)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.ContainerName, &u.ContainerIP, &u.ContainerToken, &u.Role, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, nil
}

func (s *Store) CheckPassword(u *User, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil
}

func (s *Store) ListSessions(userID int64) ([]SessionSummary, error) {
	rows, err := s.db.Query(
		`SELECT id, title, type, json_array_length(messages), created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
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

func (s *Store) GetSession(userID int64, sessionID string) (*Session, error) {
	sess := &Session{}
	err := s.db.QueryRow(
		`SELECT id, user_id, title, messages, type, workspace_path, created_at, updated_at FROM sessions WHERE id = ? AND user_id = ?`,
		sessionID, userID,
	).Scan(&sess.ID, &sess.UserID, &sess.Title, &sess.Messages, &sess.Type, &sess.WorkspacePath, &sess.CreatedAt, &sess.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return sess, nil
}

func (s *Store) CreateSession(userID int64, sessionType, workspacePath string) (*Session, error) {
	if sessionType == "" {
		sessionType = "chat"
	}

	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("generate session id: %w", err)
	}
	id := hex.EncodeToString(b)
	now := time.Now().UnixMilli()

	_, err := s.db.Exec(
		`INSERT INTO sessions (id, user_id, title, messages, type, workspace_path, created_at, updated_at) VALUES (?, ?, '新对话', '[]', ?, ?, ?, ?)`,
		id, userID, sessionType, workspacePath, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("create session: %w", err)
	}
	return &Session{
		ID:            id,
		UserID:        userID,
		Title:         "新对话",
		Messages:      "[]",
		Type:          sessionType,
		WorkspacePath: workspacePath,
		CreatedAt:     now,
		UpdatedAt:     now,
	}, nil
}

func (s *Store) UpdateSession(userID int64, sessionID, title, messages string) (*Session, error) {
	now := time.Now().UnixMilli()

	if title != "" && messages != "" {
		_, err := s.db.Exec(`UPDATE sessions SET title = ?, messages = ?, updated_at = ? WHERE id = ? AND user_id = ?`, title, messages, now, sessionID, userID)
		if err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	} else if title != "" {
		_, err := s.db.Exec(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`, title, now, sessionID, userID)
		if err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	} else if messages != "" {
		_, err := s.db.Exec(`UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ? AND user_id = ?`, messages, now, sessionID, userID)
		if err != nil {
			return nil, fmt.Errorf("update session: %w", err)
		}
	}

	return s.GetSession(userID, sessionID)
}

func (s *Store) DeleteSession(userID int64, sessionID string) error {
	result, err := s.db.Exec(`DELETE FROM sessions WHERE id = ? AND user_id = ?`, sessionID, userID)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("session not found")
	}
	return nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
