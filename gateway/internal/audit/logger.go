package audit

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
)

type Entry struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Action    string    `json:"action"`
	Detail    string    `json:"detail"`
	IP        string    `json:"ip"`
	CreatedAt time.Time `json:"created_at"`
}

type Logger struct {
	db *sql.DB
}

func NewLogger(db *sql.DB) (*Logger, error) {
	l := &Logger{db: db}
	if err := l.migrate(); err != nil {
		return nil, fmt.Errorf("migrate audit: %w", err)
	}
	return l, nil
}

func (l *Logger) migrate() error {
	_, err := l.db.Exec(`
		CREATE TABLE IF NOT EXISTS audit_logs (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id    INTEGER NOT NULL,
			action     TEXT    NOT NULL,
			detail     TEXT    NOT NULL DEFAULT '',
			ip         TEXT    NOT NULL DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	return err
}

func (l *Logger) Log(userID int64, action, detail, ip string) {
	_, err := l.db.Exec(
		`INSERT INTO audit_logs (user_id, action, detail, ip) VALUES (?, ?, ?, ?)`,
		userID, action, detail, ip,
	)
	if err != nil {
		log.Error().Err(err).Int64("user_id", userID).Str("action", action).Msg("audit log write failed")
	}
}

func (l *Logger) DB() *sql.DB {
	return l.db
}
