package store

import (
	"context"
	"database/sql"
	"fmt"
)

// Overview holds the dashboard overview metrics.
type Overview struct {
	TotalTasks     int            `json:"total_tasks"`
	ActiveTasks    int            `json:"active_tasks"`
	TotalSubTasks  int            `json:"total_sub_tasks"`
	SubTaskByStatus map[string]int `json:"sub_task_by_status"`
	TotalAgents    int            `json:"total_agents"`
	OnlineAgents   int            `json:"online_agents"`
	TopScore       int            `json:"top_score"`
	AvgScore       float64        `json:"avg_score"`
	TodayCompleted int            `json:"today_completed"`
	TodayCreated   int            `json:"today_created"`
}

func (db *DB) GetOverview(ctx context.Context, project string) (*Overview, error) {
	o := &Overview{SubTaskByStatus: make(map[string]int)}

	projectFilter := ""
	args := []any{}
	if project != "" {
		projectFilter = ` AND project = ?`
		args = append(args, project)
	}

	// Total tasks
	if err := db.conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM task WHERE 1=1`+projectFilter, args...,
	).Scan(&o.TotalTasks); err != nil {
		return nil, err
	}

	// Active tasks
	if err := db.conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM task WHERE status IN ('active','in_progress')`+projectFilter, args...,
	).Scan(&o.ActiveTasks); err != nil {
		return nil, err
	}

	// Total sub_tasks (join task for project filter)
	stQuery := `SELECT COUNT(*) FROM sub_task`
	stArgs := []any{}
	if project != "" {
		stQuery += ` JOIN task ON sub_task.task_id = task.id WHERE task.project = ?`
		stArgs = append(stArgs, project)
	}
	if err := db.conn.QueryRowContext(ctx, stQuery, stArgs...).Scan(&o.TotalSubTasks); err != nil {
		return nil, err
	}

	// Sub-task by status
	stStatusQuery := `SELECT sub_task.status, COUNT(*) FROM sub_task`
	stStatusArgs := []any{}
	if project != "" {
		stStatusQuery += ` JOIN task ON sub_task.task_id = task.id WHERE task.project = ?`
		stStatusArgs = append(stStatusArgs, project)
	}
	stStatusQuery += ` GROUP BY sub_task.status`
	rows, err := db.conn.QueryContext(ctx, stStatusQuery, stStatusArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		o.SubTaskByStatus[status] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Total agents & online
	if err := db.conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent`).Scan(&o.TotalAgents); err != nil {
		return nil, err
	}
	if err := db.conn.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM agent WHERE status != 'offline' AND last_seen_at >= datetime('now', '-5 minutes')`,
	).Scan(&o.OnlineAgents); err != nil {
		return nil, err
	}

	// Scores
	var topScore sql.NullInt64
	if err := db.conn.QueryRowContext(ctx, `SELECT MAX(total_score) FROM agent`).Scan(&topScore); err != nil {
		return nil, err
	}
	if topScore.Valid {
		o.TopScore = int(topScore.Int64)
	}

	var avgScore sql.NullFloat64
	if err := db.conn.QueryRowContext(ctx, `SELECT AVG(total_score) FROM agent`).Scan(&avgScore); err != nil {
		return nil, err
	}
	if avgScore.Valid {
		o.AvgScore = avgScore.Float64
	}

	// Today completed
	todayCompletedQuery := `SELECT COUNT(*) FROM sub_task WHERE date(completed_at) = date('now')`
	todayCompletedArgs := []any{}
	if project != "" {
		todayCompletedQuery = `SELECT COUNT(*) FROM sub_task JOIN task ON sub_task.task_id = task.id WHERE date(sub_task.completed_at) = date('now') AND task.project = ?`
		todayCompletedArgs = append(todayCompletedArgs, project)
	}
	if err := db.conn.QueryRowContext(ctx, todayCompletedQuery, todayCompletedArgs...).Scan(&o.TodayCompleted); err != nil {
		return nil, err
	}

	// Today created
	todayCreatedQuery := `SELECT COUNT(*) FROM sub_task WHERE date(created_at) = date('now')`
	todayCreatedArgs := []any{}
	if project != "" {
		todayCreatedQuery = `SELECT COUNT(*) FROM sub_task JOIN task ON sub_task.task_id = task.id WHERE date(sub_task.created_at) = date('now') AND task.project = ?`
		todayCreatedArgs = append(todayCreatedArgs, project)
	}
	if err := db.conn.QueryRowContext(ctx, todayCreatedQuery, todayCreatedArgs...).Scan(&o.TodayCreated); err != nil {
		return nil, err
	}

	return o, nil
}

// TimelineBucket holds counts per time bucket.
type TimelineBucket struct {
	Bucket    string `json:"bucket"`
	Created   int    `json:"created"`
	Completed int    `json:"completed"`
	Reviewed  int    `json:"reviewed"`
	Rejected  int    `json:"rejected"`
}

// GetTimeline returns event counts bucketed by day or hour.
func (db *DB) GetTimeline(ctx context.Context, project string, days int, bucket string) ([]TimelineBucket, error) {
	if days <= 0 {
		days = 7
	}
	if bucket != "hour" {
		bucket = "day"
	}

	var bucketExpr string
	if bucket == "hour" {
		bucketExpr = `strftime('%Y-%m-%d %H:00', created_at)`
	} else {
		bucketExpr = `date(created_at)`
	}

	query := fmt.Sprintf(`SELECT
		%s AS bucket,
		SUM(CASE WHEN action = 'create' OR (type = 'transition' AND to_status = 'pending') THEN 1 ELSE 0 END) AS created,
		SUM(CASE WHEN action = 'approve' OR (type = 'transition' AND to_status = 'done') THEN 1 ELSE 0 END) AS completed,
		SUM(CASE WHEN type = 'review' AND action = 'approve' THEN 1 ELSE 0 END) AS reviewed,
		SUM(CASE WHEN type = 'review' AND action = 'reject' THEN 1 ELSE 0 END) AS rejected
	FROM event
	WHERE created_at >= datetime('now', '-%d days')`, bucketExpr, days)

	args := []any{}
	if project != "" {
		query += ` AND project = ?`
		args = append(args, project)
	}
	query += fmt.Sprintf(` GROUP BY %s ORDER BY bucket`, bucketExpr)

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []TimelineBucket
	for rows.Next() {
		var b TimelineBucket
		if err := rows.Scan(&b.Bucket, &b.Created, &b.Completed, &b.Reviewed, &b.Rejected); err != nil {
			return nil, err
		}
		items = append(items, b)
	}
	return items, rows.Err()
}

// StateFlowEntry represents a from→to transition count.
type StateFlowEntry struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Count int    `json:"count"`
}

// GetStateFlow aggregates transition events for sankey/flow diagrams.
func (db *DB) GetStateFlow(ctx context.Context, project string, days int) ([]StateFlowEntry, error) {
	if days <= 0 {
		days = 30
	}

	query := `SELECT from_status, to_status, COUNT(*) FROM event
		WHERE type = 'transition' AND from_status != '' AND to_status != ''
		AND created_at >= datetime('now', ?)`
	args := []any{fmt.Sprintf("-%d days", days)}

	if project != "" {
		query += ` AND project = ?`
		args = append(args, project)
	}
	query += ` GROUP BY from_status, to_status ORDER BY COUNT(*) DESC`

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []StateFlowEntry
	for rows.Next() {
		var e StateFlowEntry
		if err := rows.Scan(&e.From, &e.To, &e.Count); err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	return items, rows.Err()
}

// GetDistribution returns sub_task status distribution.
func (db *DB) GetDistribution(ctx context.Context, project string) (map[string]int, error) {
	query := `SELECT sub_task.status, COUNT(*) FROM sub_task`
	args := []any{}
	if project != "" {
		query += ` JOIN task ON sub_task.task_id = task.id WHERE task.project = ?`
		args = append(args, project)
	}
	query += ` GROUP BY sub_task.status`

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	dist := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		dist[status] = count
	}
	return dist, rows.Err()
}

// AgentRankEntry holds ranking data for a single agent.
type AgentRankEntry struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Role           string  `json:"role"`
	TotalScore     int     `json:"total_score"`
	CompletedCount int     `json:"completed_count"`
	AvgMinutes     float64 `json:"avg_minutes"`
	ReworkRate     float64 `json:"rework_rate"`
	AvgReviewScore float64 `json:"avg_review_score"`
	Rank           int     `json:"rank"`
}

// GetAgentRanking returns agents ranked by total_score with performance metrics.
func (db *DB) GetAgentRanking(ctx context.Context, project string) ([]AgentRankEntry, error) {
	// Base agent query
	agents, err := db.ListAgents(ctx, "", "")
	if err != nil {
		return nil, err
	}

	var entries []AgentRankEntry
	for _, a := range agents {
		e := AgentRankEntry{
			ID:         a.ID,
			Name:       a.Name,
			Role:       a.Role,
			TotalScore: a.TotalScore,
		}

		// Completed count
		completedQuery := `SELECT COUNT(*) FROM sub_task WHERE assigned_agent = ? AND status = 'done'`
		completedArgs := []any{a.ID}
		if project != "" {
			completedQuery = `SELECT COUNT(*) FROM sub_task JOIN task ON sub_task.task_id = task.id WHERE sub_task.assigned_agent = ? AND sub_task.status = 'done' AND task.project = ?`
			completedArgs = append(completedArgs, project)
		}
		db.conn.QueryRowContext(ctx, completedQuery, completedArgs...).Scan(&e.CompletedCount)

		// Avg minutes
		avgQuery := `SELECT COALESCE(AVG(actual_minutes), 0) FROM sub_task WHERE assigned_agent = ? AND status = 'done' AND actual_minutes > 0`
		avgArgs := []any{a.ID}
		if project != "" {
			avgQuery = `SELECT COALESCE(AVG(sub_task.actual_minutes), 0) FROM sub_task JOIN task ON sub_task.task_id = task.id WHERE sub_task.assigned_agent = ? AND sub_task.status = 'done' AND sub_task.actual_minutes > 0 AND task.project = ?`
			avgArgs = append(avgArgs, project)
		}
		db.conn.QueryRowContext(ctx, avgQuery, avgArgs...).Scan(&e.AvgMinutes)

		// Rework rate
		var totalAssigned int
		var reworkCount int
		db.conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sub_task WHERE assigned_agent = ?`, a.ID,
		).Scan(&totalAssigned)
		db.conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sub_task WHERE assigned_agent = ? AND rework_count > 0`, a.ID,
		).Scan(&reworkCount)
		if totalAssigned > 0 {
			e.ReworkRate = float64(reworkCount) / float64(totalAssigned)
		}

		// Avg review score
		var avgScore sql.NullFloat64
		db.conn.QueryRowContext(ctx,
			`SELECT AVG(rr.score) FROM review_record rr
			 JOIN sub_task st ON rr.sub_task_id = st.id
			 WHERE st.assigned_agent = ?`, a.ID,
		).Scan(&avgScore)
		if avgScore.Valid {
			e.AvgReviewScore = avgScore.Float64
		}

		entries = append(entries, e)
	}

	// Sort by total_score desc and assign rank
	for i := range entries {
		rank := 1
		for j := range entries {
			if entries[j].TotalScore > entries[i].TotalScore {
				rank++
			}
		}
		entries[i].Rank = rank
	}

	return entries, nil
}

// GetAgentHeatmap returns a days×24 matrix of event counts for an agent.
func (db *DB) GetAgentHeatmap(ctx context.Context, agentID string, days int) ([][]int, error) {
	if days <= 0 {
		days = 7
	}

	matrix := make([][]int, days)
	for i := range matrix {
		matrix[i] = make([]int, 24)
	}

	query := `SELECT
		CAST(julianday('now') - julianday(date(created_at)) AS INTEGER) AS day_offset,
		CAST(strftime('%H', created_at) AS INTEGER) AS hour,
		COUNT(*)
	FROM event
	WHERE actor_id = ? AND created_at >= datetime('now', ?)
	GROUP BY day_offset, hour`

	rows, err := db.conn.QueryContext(ctx, query, agentID, fmt.Sprintf("-%d days", days))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var dayOffset, hour, count int
		if err := rows.Scan(&dayOffset, &hour, &count); err != nil {
			return nil, err
		}
		if dayOffset >= 0 && dayOffset < days && hour >= 0 && hour < 24 {
			matrix[dayOffset][hour] = count
		}
	}
	return matrix, rows.Err()
}

// VelocityData holds task completion velocity over time for burn-down charts.
type VelocityData struct {
	Daily              []DailyVelocity `json:"daily"`
	AvgCompletionHours float64         `json:"avg_completion_hours"`
	AvgReviewHours     float64         `json:"avg_review_hours"`
}

type DailyVelocity struct {
	Date              string `json:"date"`
	Created           int    `json:"created"`
	Completed         int    `json:"completed"`
	Net               int    `json:"net"`
	CumulativeBacklog int    `json:"cumulative_backlog"`
}

// GetVelocity computes daily creation/completion rates and average durations.
func (db *DB) GetVelocity(ctx context.Context, project string, days int) (*VelocityData, error) {
	if days <= 0 {
		days = 14
	}

	// Daily created counts
	createdQuery := `SELECT date(sub_task.created_at) AS d, COUNT(*) FROM sub_task`
	createdArgs := []any{}
	if project != "" {
		createdQuery += ` JOIN task ON sub_task.task_id = task.id WHERE task.project = ? AND`
		createdArgs = append(createdArgs, project)
	} else {
		createdQuery += ` WHERE`
	}
	createdQuery += fmt.Sprintf(` sub_task.created_at >= datetime('now', '-%d days') GROUP BY d ORDER BY d`, days)

	createdMap := map[string]int{}
	rows, err := db.conn.QueryContext(ctx, createdQuery, createdArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var d string
		var c int
		if err := rows.Scan(&d, &c); err != nil {
			return nil, err
		}
		createdMap[d] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Daily completed counts
	completedQuery := `SELECT date(sub_task.completed_at) AS d, COUNT(*) FROM sub_task`
	completedArgs := []any{}
	if project != "" {
		completedQuery += ` JOIN task ON sub_task.task_id = task.id WHERE task.project = ? AND`
		completedArgs = append(completedArgs, project)
	} else {
		completedQuery += ` WHERE`
	}
	completedQuery += fmt.Sprintf(` sub_task.completed_at IS NOT NULL AND sub_task.completed_at >= datetime('now', '-%d days') GROUP BY d ORDER BY d`, days)

	completedMap := map[string]int{}
	rows2, err := db.conn.QueryContext(ctx, completedQuery, completedArgs...)
	if err != nil {
		return nil, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var d string
		var c int
		if err := rows2.Scan(&d, &c); err != nil {
			return nil, err
		}
		completedMap[d] = c
	}
	if err := rows2.Err(); err != nil {
		return nil, err
	}

	// Initial backlog: open tasks before the window
	backlogQuery := `SELECT COUNT(*) FROM sub_task`
	backlogArgs := []any{}
	if project != "" {
		backlogQuery += ` JOIN task ON sub_task.task_id = task.id WHERE task.project = ? AND`
		backlogArgs = append(backlogArgs, project)
	} else {
		backlogQuery += ` WHERE`
	}
	backlogQuery += fmt.Sprintf(` sub_task.created_at < datetime('now', '-%d days') AND (sub_task.completed_at IS NULL OR sub_task.completed_at >= datetime('now', '-%d days'))`, days, days)

	var initialBacklog int
	if err := db.conn.QueryRowContext(ctx, backlogQuery, backlogArgs...).Scan(&initialBacklog); err != nil {
		return nil, err
	}

	// Build daily series
	dateRows, err := db.conn.QueryContext(ctx,
		fmt.Sprintf(`SELECT date('now', '-%d days', '+' || seq || ' days') FROM (
			WITH RECURSIVE cnt(seq) AS (SELECT 0 UNION ALL SELECT seq+1 FROM cnt WHERE seq < %d)
			SELECT seq FROM cnt
		)`, days, days-1))
	if err != nil {
		return nil, err
	}
	defer dateRows.Close()

	var daily []DailyVelocity
	cumulative := initialBacklog
	for dateRows.Next() {
		var d string
		if err := dateRows.Scan(&d); err != nil {
			return nil, err
		}
		cr := createdMap[d]
		co := completedMap[d]
		cumulative += cr - co
		daily = append(daily, DailyVelocity{
			Date:              d,
			Created:           cr,
			Completed:         co,
			Net:               cr - co,
			CumulativeBacklog: cumulative,
		})
	}
	if err := dateRows.Err(); err != nil {
		return nil, err
	}

	// Avg completion hours (started_at → completed_at)
	avgCompQuery := `SELECT COALESCE(AVG((julianday(sub_task.completed_at) - julianday(sub_task.started_at)) * 24), 0) FROM sub_task`
	avgCompArgs := []any{}
	if project != "" {
		avgCompQuery += ` JOIN task ON sub_task.task_id = task.id WHERE task.project = ? AND`
		avgCompArgs = append(avgCompArgs, project)
	} else {
		avgCompQuery += ` WHERE`
	}
	avgCompQuery += ` sub_task.completed_at IS NOT NULL AND sub_task.started_at IS NOT NULL`

	var avgCompHours float64
	db.conn.QueryRowContext(ctx, avgCompQuery, avgCompArgs...).Scan(&avgCompHours)

	// Avg review hours (from review_record created_at to sub_task completed_at)
	avgRevQuery := `SELECT COALESCE(AVG((julianday(st.completed_at) - julianday(rr.created_at)) * 24), 0)
		FROM review_record rr JOIN sub_task st ON rr.sub_task_id = st.id`
	avgRevArgs := []any{}
	if project != "" {
		avgRevQuery += ` JOIN task ON st.task_id = task.id WHERE task.project = ? AND`
		avgRevArgs = append(avgRevArgs, project)
	} else {
		avgRevQuery += ` WHERE`
	}
	avgRevQuery += ` st.completed_at IS NOT NULL`

	var avgRevHours float64
	db.conn.QueryRowContext(ctx, avgRevQuery, avgRevArgs...).Scan(&avgRevHours)

	return &VelocityData{
		Daily:              daily,
		AvgCompletionHours: avgCompHours,
		AvgReviewHours:     avgRevHours,
	}, nil
}

// AgentWorkload holds current workload data for a single agent.
type AgentWorkload struct {
	AgentID              string            `json:"agent_id"`
	AgentName            string            `json:"agent_name"`
	Role                 string            `json:"role"`
	ActiveCount          int               `json:"active_count"`
	PendingReviewCount   int               `json:"pending_review_count"`
	BlockedCount         int               `json:"blocked_count"`
	CompletedToday       int               `json:"completed_today"`
	TotalScore           int               `json:"total_score"`
	AvgCompletionMinutes float64           `json:"avg_completion_minutes"`
	CurrentSubTasks      []WorkloadSubTask `json:"current_sub_tasks"`
}

// WorkloadSubTask is a lightweight sub-task entry for workload display.
type WorkloadSubTask struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	Priority  string  `json:"priority"`
	StartedAt *string `json:"started_at"`
}

// GetAgentWorkload returns workload distribution across all agents.
func (db *DB) GetAgentWorkload(ctx context.Context, project string) ([]AgentWorkload, error) {
	agents, err := db.ListAgents(ctx, "", "")
	if err != nil {
		return nil, err
	}

	projectJoin := ""
	projectWhere := ""
	if project != "" {
		projectJoin = ` JOIN task ON sub_task.task_id = task.id`
		projectWhere = ` AND task.project = ?`
	}

	var result []AgentWorkload
	for _, a := range agents {
		w := AgentWorkload{
			AgentID:   a.ID,
			AgentName: a.Name,
			Role:      a.Role,
			TotalScore: a.TotalScore,
		}

		baseArgs := func() []any {
			args := []any{a.ID}
			if project != "" {
				args = append(args, project)
			}
			return args
		}

		// Active (in_progress) count
		db.conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sub_task`+projectJoin+` WHERE sub_task.assigned_agent = ? AND sub_task.status = 'in_progress'`+projectWhere,
			baseArgs()...,
		).Scan(&w.ActiveCount)

		// Pending review (submitted) count
		db.conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sub_task`+projectJoin+` WHERE sub_task.assigned_agent = ? AND sub_task.status = 'submitted'`+projectWhere,
			baseArgs()...,
		).Scan(&w.PendingReviewCount)

		// Blocked count
		db.conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sub_task`+projectJoin+` WHERE sub_task.assigned_agent = ? AND sub_task.status = 'blocked'`+projectWhere,
			baseArgs()...,
		).Scan(&w.BlockedCount)

		// Completed today
		db.conn.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sub_task`+projectJoin+` WHERE sub_task.assigned_agent = ? AND sub_task.status = 'done' AND date(sub_task.completed_at) = date('now')`+projectWhere,
			baseArgs()...,
		).Scan(&w.CompletedToday)

		// Avg completion minutes
		db.conn.QueryRowContext(ctx,
			`SELECT COALESCE(AVG(sub_task.actual_minutes), 0) FROM sub_task`+projectJoin+` WHERE sub_task.assigned_agent = ? AND sub_task.status = 'done' AND sub_task.actual_minutes > 0`+projectWhere,
			baseArgs()...,
		).Scan(&w.AvgCompletionMinutes)

		// Current non-done sub-tasks
		stQuery := `SELECT sub_task.id, sub_task.name, sub_task.status, sub_task.priority, sub_task.started_at FROM sub_task` + projectJoin +
			` WHERE sub_task.assigned_agent = ? AND sub_task.status NOT IN ('done', 'cancelled')` + projectWhere +
			` ORDER BY CASE sub_task.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`
		stRows, err := db.conn.QueryContext(ctx, stQuery, baseArgs()...)
		if err != nil {
			return nil, err
		}
		for stRows.Next() {
			var st WorkloadSubTask
			if err := stRows.Scan(&st.ID, &st.Name, &st.Status, &st.Priority, &st.StartedAt); err != nil {
				stRows.Close()
				return nil, err
			}
			w.CurrentSubTasks = append(w.CurrentSubTasks, st)
		}
		stRows.Close()
		if err := stRows.Err(); err != nil {
			return nil, err
		}

		if w.CurrentSubTasks == nil {
			w.CurrentSubTasks = []WorkloadSubTask{}
		}

		result = append(result, w)
	}

	if result == nil {
		result = []AgentWorkload{}
	}
	return result, nil
}

// InteractionEdge represents an agent↔agent collaboration edge.
type InteractionEdge struct {
	Source     string `json:"source"`
	Target     string `json:"target"`
	Type       string `json:"type"`
	Weight     int    `json:"weight"`
	LastActive string `json:"last_active"`
}

// AggregateInteractions returns agent↔agent collaboration edges from the event table.
func (db *DB) AggregateInteractions(ctx context.Context, project string, days int) ([]InteractionEdge, error) {
	if days <= 0 {
		days = 7
	}

	query := `SELECT
		actor_id,
		target_id,
		type,
		COUNT(*) AS weight,
		MAX(created_at) AS last_active
	FROM event
	WHERE actor_id != '' AND target_id != ''
		AND actor_id != target_id
		AND target_type = 'sub_task'
		AND created_at >= datetime('now', ?)`
	args := []any{fmt.Sprintf("-%d days", days)}

	if project != "" {
		query += ` AND project = ?`
		args = append(args, project)
	}
	query += ` GROUP BY actor_id, target_id, type ORDER BY weight DESC`

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []InteractionEdge
	for rows.Next() {
		var e InteractionEdge
		if err := rows.Scan(&e.Source, &e.Target, &e.Type, &e.Weight, &e.LastActive); err != nil {
			return nil, err
		}
		edges = append(edges, e)
	}
	return edges, rows.Err()
}
