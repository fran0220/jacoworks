package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DBTX is satisfied by both *sql.DB and *sql.Tx, allowing store methods
// to be called inside or outside a transaction.
type DBTX interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type DB struct {
	conn *sql.DB
}

func Open(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	conn, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	conn.SetMaxOpenConns(2)

	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
		"PRAGMA synchronous=NORMAL",
	}
	for _, p := range pragmas {
		if _, err := conn.Exec(p); err != nil {
			conn.Close()
			return nil, fmt.Errorf("exec %s: %w", p, err)
		}
	}

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return db, nil
}

func (db *DB) Close() error {
	return db.conn.Close()
}

func (db *DB) Conn() *sql.DB {
	return db.conn
}

func (db *DB) WithTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (db *DB) migrate() error {
	_, err := db.conn.Exec(schema)
	return err
}

const schema = `
CREATE TABLE IF NOT EXISTS agent (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    role              TEXT NOT NULL,
    description       TEXT DEFAULT '',
    status            TEXT DEFAULT 'idle',
    api_key           TEXT UNIQUE NOT NULL,
    total_score       INTEGER DEFAULT 0,
    capabilities      TEXT DEFAULT '',
    avatar_seed       TEXT DEFAULT '',
    current_action    TEXT DEFAULT '',
    current_sub_task_id TEXT,
    current_session_id TEXT,
    last_seen_at      DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task (
    id           TEXT PRIMARY KEY,
    project      TEXT DEFAULT 'default',
    name         TEXT NOT NULL,
    description  TEXT DEFAULT '',
    type         TEXT DEFAULT 'once',
    status       TEXT DEFAULT 'planning',
    created_by   TEXT,
    deadline     DATETIME,
    tags         TEXT DEFAULT '[]',
    metadata     TEXT DEFAULT '{}',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_task_project_status ON task(project, status);

CREATE TABLE IF NOT EXISTS module (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES task(id),
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    sort_order  INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sub_task (
    id                 TEXT PRIMARY KEY,
    task_id            TEXT NOT NULL REFERENCES task(id),
    module_id          TEXT REFERENCES module(id),
    name               TEXT NOT NULL,
    description        TEXT DEFAULT '',
    deliverable        TEXT DEFAULT '',
    acceptance         TEXT DEFAULT '',
    type               TEXT DEFAULT 'once',
    status             TEXT DEFAULT 'pending',
    priority           TEXT DEFAULT 'medium',
    assigned_agent     TEXT REFERENCES agent(id),
    current_session_id TEXT,
    rework_count       INTEGER DEFAULT 0,
    estimated_minutes  INTEGER DEFAULT 0,
    actual_minutes     INTEGER DEFAULT 0,
    recurring_config   TEXT DEFAULT '{}',
    tags               TEXT DEFAULT '[]',
    deadline           DATETIME,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at         DATETIME,
    completed_at       DATETIME
);
CREATE INDEX IF NOT EXISTS idx_sub_task_task ON sub_task(task_id);
CREATE INDEX IF NOT EXISTS idx_sub_task_status ON sub_task(status);
CREATE INDEX IF NOT EXISTS idx_sub_task_agent_status ON sub_task(assigned_agent, status);

CREATE TABLE IF NOT EXISTS event (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    TEXT UNIQUE NOT NULL,
    project     TEXT DEFAULT '',
    type        TEXT NOT NULL,
    actor_id    TEXT,
    actor_name  TEXT,
    actor_role  TEXT,
    task_id     TEXT,
    sub_task_id TEXT,
    session_id  TEXT,
    target_type TEXT,
    target_id   TEXT,
    target_name TEXT,
    action      TEXT NOT NULL,
    from_status TEXT DEFAULT '',
    to_status   TEXT DEFAULT '',
    summary     TEXT DEFAULT '',
    payload     TEXT DEFAULT '{}',
    visual      TEXT DEFAULT '{}',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_event_type ON event(type);
CREATE INDEX IF NOT EXISTS idx_event_project ON event(project);
CREATE INDEX IF NOT EXISTS idx_event_actor ON event(actor_id);
CREATE INDEX IF NOT EXISTS idx_event_target ON event(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_event_created ON event(created_at);

CREATE TABLE IF NOT EXISTS review_record (
    id              TEXT PRIMARY KEY,
    sub_task_id     TEXT NOT NULL REFERENCES sub_task(id),
    reviewer_agent  TEXT NOT NULL REFERENCES agent(id),
    round           INTEGER NOT NULL,
    result          TEXT NOT NULL,
    score           INTEGER NOT NULL,
    issues          TEXT DEFAULT '',
    comment         TEXT DEFAULT '',
    rework_agent    TEXT REFERENCES agent(id),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_review_sub_task ON review_record(sub_task_id);

CREATE TABLE IF NOT EXISTS patrol_record (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    severity     TEXT NOT NULL,
    sub_task_id  TEXT REFERENCES sub_task(id),
    agent_id     TEXT REFERENCES agent(id),
    description  TEXT NOT NULL,
    action_taken TEXT DEFAULT '',
    status       TEXT DEFAULT 'open',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at  DATETIME
);
CREATE INDEX IF NOT EXISTS idx_patrol_status ON patrol_record(status);

CREATE TABLE IF NOT EXISTS rule (
    id          TEXT PRIMARY KEY,
    scope       TEXT NOT NULL,
    project     TEXT DEFAULT '',
    task_id     TEXT REFERENCES task(id),
    sub_task_id TEXT REFERENCES sub_task(id),
    content     TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rule_scope ON rule(scope);

CREATE TABLE IF NOT EXISTS request_log (
    id              TEXT PRIMARY KEY,
    timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP,
    method          TEXT NOT NULL,
    path            TEXT NOT NULL,
    agent_id        TEXT,
    agent_name      TEXT,
    agent_role      TEXT,
    request_body    TEXT,
    response_status INTEGER
);
CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_request_log_agent ON request_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_request_log_path ON request_log(path);

CREATE TABLE IF NOT EXISTS activity_log (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agent(id),
    sub_task_id TEXT REFERENCES sub_task(id),
    action      TEXT NOT NULL,
    summary     TEXT DEFAULT '',
    session_id  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_log_agent ON activity_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);

CREATE TABLE IF NOT EXISTS reward_log (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    sub_task_id TEXT,
    reason      TEXT NOT NULL,
    score_delta INTEGER NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reward_log_agent ON reward_log(agent_id);
`
