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
		)
	`)
	return err
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
