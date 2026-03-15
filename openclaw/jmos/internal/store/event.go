package store

import (
	"context"
	"database/sql"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/model"
)

// InsertEvent inserts an event into the event table. The seq column is AUTOINCREMENT
// and will be assigned by SQLite. Returns the assigned seq.
func (db *DB) InsertEvent(ctx context.Context, e *model.Event) (int64, error) {
	return db.InsertEventTx(ctx, db.conn, e)
}

// InsertEventTx inserts an event within a given transaction.
func (db *DB) InsertEventTx(ctx context.Context, tx DBTX, e *model.Event) (int64, error) {
	res, err := tx.ExecContext(ctx,
		`INSERT INTO event (event_id, project, type, actor_id, actor_name, actor_role, task_id, sub_task_id, session_id, target_type, target_id, target_name, action, from_status, to_status, summary, payload, visual)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		e.EventID, e.Project, e.Type, e.ActorID, e.ActorName, e.ActorRole,
		e.TaskID, e.SubTaskID, e.SessionID,
		e.TargetType, e.TargetID, e.TargetName,
		e.Action, e.FromStatus, e.ToStatus, e.Summary, e.Payload, e.Visual,
	)
	if err != nil {
		return 0, err
	}
	seq, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	e.Seq = seq
	return seq, nil
}

// ListEventsAfterSeq returns events with seq > afterSeq, up to limit.
func (db *DB) ListEventsAfterSeq(ctx context.Context, afterSeq int64, limit int) ([]*model.Event, int64, bool, error) {
	if limit < 1 {
		limit = 50
	}

	rows, err := db.conn.QueryContext(ctx,
		`SELECT seq, event_id, project, type, actor_id, actor_name, actor_role, task_id, sub_task_id, session_id, target_type, target_id, target_name, action, from_status, to_status, summary, payload, visual, created_at
		 FROM event WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
		afterSeq, limit+1,
	)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()

	var events []*model.Event
	for rows.Next() {
		e := &model.Event{}
		if err := rows.Scan(
			&e.Seq, &e.EventID, &e.Project, &e.Type, &e.ActorID, &e.ActorName, &e.ActorRole,
			&e.TaskID, &e.SubTaskID, &e.SessionID,
			&e.TargetType, &e.TargetID, &e.TargetName,
			&e.Action, &e.FromStatus, &e.ToStatus, &e.Summary, &e.Payload, &e.Visual,
			&e.CreatedAt,
		); err != nil {
			return nil, 0, false, err
		}
		events = append(events, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, false, err
	}

	hasMore := len(events) > limit
	if hasMore {
		events = events[:limit]
	}

	var latestSeq int64
	if len(events) > 0 {
		latestSeq = events[len(events)-1].Seq
	} else {
		latestSeq = afterSeq
	}

	return events, latestSeq, hasMore, nil
}

// LatestSeq returns the highest seq in the event table, or 0 if empty.
func (db *DB) LatestSeq(ctx context.Context) (int64, error) {
	var seq sql.NullInt64
	if err := db.conn.QueryRowContext(ctx, `SELECT MAX(seq) FROM event`).Scan(&seq); err != nil {
		return 0, err
	}
	if !seq.Valid {
		return 0, nil
	}
	return seq.Int64, nil
}
