package main

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/container"
)

const (
	defaultCrewFeedLimit = 100
	maxCrewFeedLimit     = 500
	missingFileExitCode  = 42
)

var (
	crewRegistryCandidates = []string{
		`"$HOME/.pi/agent/messenger/registry.json"`,
		`"$HOME/.pi/messenger/registry.json"`,
	}
	crewTasksCandidates = []string{
		`"$HOME/.pi/messenger/crew/tasks.json"`,
		`"$HOME/.pi/agent/messenger/crew/tasks.json"`,
	}
	crewFeedCandidates = []string{
		`"$HOME/.pi/messenger/feed.jsonl"`,
		`"$HOME/.pi/agent/messenger/feed.jsonl"`,
	}
	crewPlanningCandidates = []string{
		`"$HOME/.pi/messenger/crew/planning-progress.md"`,
		`"$HOME/.pi/agent/messenger/crew/planning-progress.md"`,
	}
	crewActiveTaskStates = map[string]struct{}{
		"active":      {},
		"assigned":    {},
		"claimed":     {},
		"in_progress": {},
		"in-progress": {},
		"started":     {},
		"starting":    {},
		"working":     {},
	}
	crewTerminalTaskStates = map[string]struct{}{
		"archived":  {},
		"canceled":  {},
		"cancelled": {},
		"closed":    {},
		"complete":  {},
		"completed": {},
		"done":      {},
		"failed":    {},
		"released":  {},
		"timeout":   {},
		"timed_out": {},
	}
	crewRoleMap = map[string]string{
		"crew-planner":  "planner",
		"crew-worker":   "executor",
		"crew-reviewer": "reviewer",
		"crew-patrol":   "patrol",
	}
	crewStatusMap = map[string]string{
		"active": "working",
		"idle":   "thinking",
		"away":   "idle",
		"stuck":  "idle",
	}
)

type crewVMExec interface {
	Exec(ctx context.Context, name string, cmd ...string) (*container.ExecResult, error)
}

type crewSubTaskBrief struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	ModuleName *string `json:"module_name"`
}

type crewRecentAction struct {
	Method         string `json:"method"`
	Path           string `json:"path"`
	RequestBody    string `json:"request_body"`
	ResponseStatus *int   `json:"response_status"`
	Timestamp      string `json:"timestamp"`
}

type crewAgentSummary struct {
	ID                string             `json:"id"`
	Name              string             `json:"name"`
	Role              string             `json:"role"`
	TotalScore        int                `json:"total_score"`
	TodayRequestCount int                `json:"today_request_count"`
	TodaySubmitCount  int                `json:"today_submit_count"`
	TodayReviewCount  int                `json:"today_review_count"`
	CurrentSubTask    *crewSubTaskBrief  `json:"current_sub_task"`
	RecentActions     []crewRecentAction `json:"recent_actions"`
	PresenceState     string             `json:"presence_state,omitempty"`
	Source            string             `json:"source,omitempty"`
}

type crewFeedLog struct {
	ID             string `json:"id"`
	Timestamp      string `json:"timestamp"`
	Method         string `json:"method"`
	Path           string `json:"path"`
	AgentID        string `json:"agent_id"`
	AgentName      string `json:"agent_name"`
	AgentRole      string `json:"agent_role"`
	RequestBody    string `json:"request_body"`
	ResponseStatus *int   `json:"response_status"`
}

type crewTaskRecord struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	ModuleName   *string  `json:"module_name"`
	Status       string   `json:"status"`
	Dependencies []string `json:"dependencies"`
	Assignee     *string  `json:"assignee"`
	Wave         any      `json:"wave"`
	Claimed      bool     `json:"claimed"`
	UpdatedAt    string   `json:"updated_at,omitempty"`
}

type crewDependency struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type crewTasksResponse struct {
	Tasks            []crewTaskRecord `json:"tasks"`
	Dependencies     []crewDependency `json:"dependencies"`
	PlanningProgress string           `json:"planningProgress,omitempty"`
}

type crewSnapshot struct {
	Summaries        []crewAgentSummary
	Feed             []crewFeedLog
	Tasks            []crewTaskRecord
	Dependencies     []crewDependency
	PlanningProgress string
}

type crewAgentAccumulator struct {
	Summary        crewAgentSummary
	NormalizedID   string
	NormalizedName string
	Presence       string
	ToolCallCount  int
	FeedEvents     []crewFeedLog
	CurrentTask    *crewTaskRecord
	RequestCount   int
	SubmitCount    int
	ReviewCount    int
}

type crewTaskState struct {
	Record             crewTaskRecord
	NormalizedAgentID  string
	NormalizedAssignee string
	UpdatedAt          time.Time
	HasUpdatedAt       bool
	Priority           int
	IsClaimed          bool
}

type crewFeedEvent struct {
	Log          crewFeedLog
	AgentKeys    []string
	Timestamp    time.Time
	HasTimestamp bool
	Order        int
	Kind         string
}

func crewStateHandler(vm crewVMExec, containerLookup func(ctx context.Context, userID string) (string, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		snapshot, err := loadCrewSnapshot(r.Context(), vm, containerLookup, user.ID, defaultCrewFeedLimit)
		if err != nil {
			log.Warn().Err(err).Str("user_id", user.ID).Msg("load crew state failed")
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to read crew state"})
			return
		}

		writeJSON(w, http.StatusOK, snapshot.Summaries)
	}
}

func crewFeedHandler(vm crewVMExec, containerLookup func(ctx context.Context, userID string) (string, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		limit := parseCrewFeedLimit(r.URL.Query().Get("limit"))
		snapshot, err := loadCrewSnapshot(r.Context(), vm, containerLookup, user.ID, limit)
		if err != nil {
			log.Warn().Err(err).Str("user_id", user.ID).Msg("load crew feed failed")
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to read crew feed"})
			return
		}

		since := strings.TrimSpace(r.URL.Query().Get("since"))
		if since == "" {
			writeJSON(w, http.StatusOK, snapshot.Feed)
			return
		}

		sinceTime, ok := parseFlexibleTime(since)
		if !ok {
			writeJSON(w, http.StatusOK, snapshot.Feed)
			return
		}

		filtered := make([]crewFeedLog, 0, len(snapshot.Feed))
		for _, item := range snapshot.Feed {
			ts, ok := parseFlexibleTime(item.Timestamp)
			if !ok || !ts.After(sinceTime) {
				continue
			}
			filtered = append(filtered, item)
		}

		writeJSON(w, http.StatusOK, filtered)
	}
}

func crewTasksHandler(vm crewVMExec, containerLookup func(ctx context.Context, userID string) (string, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		snapshot, err := loadCrewSnapshot(r.Context(), vm, containerLookup, user.ID, defaultCrewFeedLimit)
		if err != nil {
			log.Warn().Err(err).Str("user_id", user.ID).Msg("load crew tasks failed")
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to read crew tasks"})
			return
		}

		writeJSON(w, http.StatusOK, crewTasksResponse{
			Tasks:            snapshot.Tasks,
			Dependencies:     snapshot.Dependencies,
			PlanningProgress: snapshot.PlanningProgress,
		})
	}
}

func loadCrewSnapshot(ctx context.Context, vm crewVMExec, containerLookup func(ctx context.Context, userID string) (string, error), userID string, feedLimit int) (*crewSnapshot, error) {
	containerName, err := containerLookup(ctx, userID)
	if err != nil || strings.TrimSpace(containerName) == "" {
		return &crewSnapshot{Summaries: []crewAgentSummary{}, Feed: []crewFeedLog{}, Tasks: []crewTaskRecord{}, Dependencies: []crewDependency{}}, nil
	}

	readCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	registryBody, err := readFirstExistingFile(readCtx, vm, containerName, crewRegistryCandidates)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(registryBody) == "" {
		return &crewSnapshot{Summaries: []crewAgentSummary{}, Feed: []crewFeedLog{}, Tasks: []crewTaskRecord{}, Dependencies: []crewDependency{}}, nil
	}

	_, agentOrder, err := parseCrewRegistry(registryBody)
	if err != nil {
		return nil, err
	}
	if len(agentOrder) == 0 {
		return &crewSnapshot{Summaries: []crewAgentSummary{}, Feed: []crewFeedLog{}, Tasks: []crewTaskRecord{}, Dependencies: []crewDependency{}}, nil
	}

	tasksBody, err := readFirstExistingFile(readCtx, vm, containerName, crewTasksCandidates)
	if err != nil {
		return nil, err
	}
	var tasks []crewTaskState
	var dependencies []crewDependency
	if strings.TrimSpace(tasksBody) != "" {
		parsedTasks, deps, parseErr := parseCrewTasks(tasksBody)
		if parseErr != nil {
			log.Warn().Err(parseErr).Str("container", containerName).Msg("parse crew tasks failed")
		} else {
			tasks = parsedTasks
			dependencies = deps
		}
	}

	feedBody, err := readTailExistingFile(readCtx, vm, containerName, crewFeedCandidates, feedLimit)
	if err != nil {
		return nil, err
	}
	var feedEvents []crewFeedEvent
	if strings.TrimSpace(feedBody) != "" {
		parsedFeed, parseErr := parseCrewFeed(feedBody)
		if parseErr != nil {
			log.Warn().Err(parseErr).Str("container", containerName).Msg("parse crew feed failed")
		} else {
			feedEvents = parsedFeed
		}
	}

	planningProgress, err := readFirstExistingFile(readCtx, vm, containerName, crewPlanningCandidates)
	if err != nil {
		return nil, err
	}

	assignCrewTasks(agentOrder, tasks)
	assignCrewFeed(agentOrder, feedEvents)

	summaries := make([]crewAgentSummary, 0, len(agentOrder))
	for _, agent := range agentOrder {
		finalizeCrewSummary(agent)
		summaries = append(summaries, agent.Summary)
	}

	feed := make([]crewFeedLog, 0, len(feedEvents))
	for _, event := range feedEvents {
		feed = append(feed, event.Log)
	}

	taskRecords := make([]crewTaskRecord, 0, len(tasks))
	for _, task := range tasks {
		taskRecords = append(taskRecords, task.Record)
	}

	return &crewSnapshot{
		Summaries:        summaries,
		Feed:             feed,
		Tasks:            taskRecords,
		Dependencies:     dependencies,
		PlanningProgress: strings.TrimSpace(planningProgress),
	}, nil
}

func parseCrewFeedLimit(raw string) int {
	limit, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || limit <= 0 {
		return defaultCrewFeedLimit
	}
	if limit > maxCrewFeedLimit {
		return maxCrewFeedLimit
	}
	return limit
}

func readFirstExistingFile(ctx context.Context, vm crewVMExec, containerName string, candidates []string) (string, error) {
	script := fmt.Sprintf("set -eu; for path in %s; do if [ -f \"$path\" ]; then exec cat -- \"$path\"; fi; done; exit %d", strings.Join(candidates, " "), missingFileExitCode)
	result, err := vm.Exec(ctx, containerName, "sh", "-lc", script)
	if isMissingExecResult(result, err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read crew file: %w", err)
	}
	if result == nil {
		return "", nil
	}
	return result.Stdout, nil
}

func readTailExistingFile(ctx context.Context, vm crewVMExec, containerName string, candidates []string, lines int) (string, error) {
	if lines <= 0 {
		lines = defaultCrewFeedLimit
	}
	script := fmt.Sprintf("set -eu; for path in %s; do if [ -f \"$path\" ]; then exec tail -n %d -- \"$path\"; fi; done; exit %d", strings.Join(candidates, " "), lines, missingFileExitCode)
	result, err := vm.Exec(ctx, containerName, "sh", "-lc", script)
	if isMissingExecResult(result, err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read crew tail: %w", err)
	}
	if result == nil {
		return "", nil
	}
	return result.Stdout, nil
}

func isMissingExecResult(result *container.ExecResult, err error) bool {
	if result != nil && result.ExitCode == missingFileExitCode {
		return true
	}
	if err == nil {
		return false
	}
	message := err.Error()
	if result != nil && strings.TrimSpace(result.Stderr) != "" {
		message = result.Stderr
	}
	message = strings.ToLower(strings.TrimSpace(message))
	return strings.Contains(message, "no such file") || strings.Contains(message, "exit status 42") || strings.Contains(message, "exit code 42")
}

func parseCrewRegistry(body string) (map[string]*crewAgentAccumulator, []*crewAgentAccumulator, error) {
	var payload any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return nil, nil, fmt.Errorf("parse registry json: %w", err)
	}
	entries := extractObjectList(payload, "registry", "agents", "members", "items")
	byKey := make(map[string]*crewAgentAccumulator)
	order := make([]*crewAgentAccumulator, 0, len(entries))

	for _, entry := range entries {
		name := firstString(entry, "name", "agent_name", "agentName", "display_name", "displayName")
		if name == "" {
			continue
		}
		id := firstString(entry, "id", "agent_id", "agentId", "key", "session_id", "sessionId")
		if id == "" {
			id = "agent:" + normalizeToken(name)
		}
		role := normalizeCrewRole(firstString(entry, "role", "agent_role", "agentRole", "type", "kind"))
		presence := normalizeCrewPresence(firstString(entry, "status", "state"))
		toolCalls := firstInt(entry, "toolCallCount", "tool_call_count", "tool_calls", "toolCalls", "calls")
		acc := &crewAgentAccumulator{
			Summary: crewAgentSummary{
				ID:                id,
				Name:              name,
				Role:              role,
				TotalScore:        0,
				TodayRequestCount: toolCalls,
				TodaySubmitCount:  0,
				TodayReviewCount:  0,
				CurrentSubTask:    nil,
				RecentActions:     []crewRecentAction{},
				PresenceState:     presence,
				Source:            "crew",
			},
			NormalizedID:   normalizeToken(id),
			NormalizedName: normalizeToken(name),
			Presence:       presence,
			ToolCallCount:  toolCalls,
			FeedEvents:     []crewFeedLog{},
		}
		order = append(order, acc)
		for _, key := range []string{acc.NormalizedID, acc.NormalizedName} {
			if key != "" {
				byKey[key] = acc
			}
		}
	}

	return byKey, order, nil
}

func parseCrewTasks(body string) ([]crewTaskState, []crewDependency, error) {
	var payload any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return nil, nil, fmt.Errorf("parse tasks json: %w", err)
	}
	entries := extractObjectList(payload, "tasks", "sub_tasks", "subtasks", "items", "entries")
	tasks := make([]crewTaskState, 0, len(entries))
	dependencies := make([]crewDependency, 0)

	for _, entry := range entries {
		id := firstString(entry, "id", "task_id", "sub_task_id", "subTaskId")
		if id == "" {
			continue
		}
		name := firstString(entry, "name", "title", "summary", "task_name", "sub_task_name")
		if name == "" {
			name = id
		}
		moduleName := nullableString(firstString(entry, "module_name", "module", "moduleName", "area", "component"))
		status := firstString(entry, "status", "state", "phase", "stage")
		agentID := firstString(entry,
			"claimed_by_id", "claimedById", "assignee_id", "assigneeId", "assigned_agent_id", "assignedAgentId", "owner_id", "ownerId",
			"claimed_by.id", "claim.agent_id", "assignee.id", "owner.id",
		)
		assignee := firstString(entry,
			"claimed_by", "claimedBy", "assignee", "assigned_to", "assignedTo", "assigned_agent", "assignedAgent", "owner", "agent_name", "agentName",
			"claimed_by.name", "claim.agent_name", "assignee.name", "owner.name",
		)
		waveValue, _ := lookupValue(entry, "wave")
		if waveValue == nil {
			waveValue, _ = lookupValue(entry, "wave_id")
		}
		deps := uniqueStrings(flattenStringValues(entry, "dependencies", "depends_on", "dependsOn", "blocked_by", "blockedBy", "prerequisites"))
		timestampRaw := firstString(entry, "updated_at", "updatedAt", "started_at", "startedAt", "claimed_at", "claimedAt", "created_at", "createdAt", "timestamp", "ts")
		updatedAt, hasUpdatedAt := parseFlexibleTime(timestampRaw)
		claimed := isClaimedTask(status, entry, assignee)
		tasks = append(tasks, crewTaskState{
			Record: crewTaskRecord{
				ID:           id,
				Name:         name,
				ModuleName:   moduleName,
				Status:       status,
				Dependencies: deps,
				Assignee:     nullableString(assignee),
				Wave:         normalizeWaveValue(waveValue),
				Claimed:      claimed,
				UpdatedAt:    normalizeTimeString(timestampRaw, updatedAt, hasUpdatedAt),
			},
			NormalizedAgentID:  normalizeToken(agentID),
			NormalizedAssignee: normalizeToken(assignee),
			UpdatedAt:          updatedAt,
			HasUpdatedAt:       hasUpdatedAt,
			Priority:           taskStatusPriority(status),
			IsClaimed:          claimed,
		})
		for _, dep := range deps {
			dependencies = append(dependencies, crewDependency{From: dep, To: id})
		}
	}

	sort.Slice(tasks, func(i, j int) bool {
		if tasks[i].Priority != tasks[j].Priority {
			return tasks[i].Priority > tasks[j].Priority
		}
		if tasks[i].HasUpdatedAt && tasks[j].HasUpdatedAt && !tasks[i].UpdatedAt.Equal(tasks[j].UpdatedAt) {
			return tasks[i].UpdatedAt.After(tasks[j].UpdatedAt)
		}
		if tasks[i].HasUpdatedAt != tasks[j].HasUpdatedAt {
			return tasks[i].HasUpdatedAt
		}
		return tasks[i].Record.Name < tasks[j].Record.Name
	})

	return tasks, dependencies, nil
}

func parseCrewFeed(body string) ([]crewFeedEvent, error) {
	scanner := bufio.NewScanner(strings.NewReader(body))
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	events := make([]crewFeedEvent, 0)
	lineNo := 0

	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var payload any
		if err := json.Unmarshal([]byte(line), &payload); err != nil {
			continue
		}
		rec := unwrapFeedRecord(asRecord(payload))
		if len(rec) == 0 {
			continue
		}

		kind := normalizeFeedKind(firstString(rec, "kind", "type", "event", "action", "name"))
		agentID := firstString(rec, "agent_id", "agentId", "actor_id", "actorId", "source_id", "sourceId")
		agentName := firstString(rec, "agent_name", "agentName", "actor", "source", "name", "agent.name", "actor.name")
		agentRole := normalizeCrewRole(firstString(rec, "agent_role", "agentRole", "role"))
		timestampRaw := firstString(rec, "timestamp", "time", "ts", "created_at", "createdAt", "at")
		timestamp, hasTimestamp := parseFlexibleTime(timestampRaw)

		method := strings.ToUpper(strings.TrimSpace(firstString(rec, "method", "http_method", "httpMethod", "verb")))
		path := strings.TrimSpace(firstString(rec, "path", "route", "endpoint", "url"))
		requestBody := buildFeedRequestBody(rec, kind)
		responseStatus := firstHTTPStatus(rec, "response_status", "responseStatus", "status_code", "statusCode", "code")
		if method == "" || path == "" {
			method, path = synthesizeFeedRoute(kind, rec)
		}
		if responseStatus == nil && method != "EVENT" {
			status := http.StatusOK
			responseStatus = &status
		}

		id := firstString(rec, "id", "event_id", "eventId")
		if id == "" {
			hash := sha1.Sum([]byte(fmt.Sprintf("%d:%s", lineNo, line)))
			id = "feed-" + hex.EncodeToString(hash[:8])
		}

		events = append(events, crewFeedEvent{
			Log: crewFeedLog{
				ID:             id,
				Timestamp:      normalizeTimeString(timestampRaw, timestamp, hasTimestamp),
				Method:         method,
				Path:           path,
				AgentID:        agentID,
				AgentName:      agentName,
				AgentRole:      agentRole,
				RequestBody:    requestBody,
				ResponseStatus: responseStatus,
			},
			AgentKeys:    uniqueStrings([]string{normalizeToken(agentID), normalizeToken(agentName)}),
			Timestamp:    timestamp,
			HasTimestamp: hasTimestamp,
			Order:        lineNo,
			Kind:         kind,
		})
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan feed jsonl: %w", err)
	}

	sort.Slice(events, func(i, j int) bool {
		if events[i].HasTimestamp && events[j].HasTimestamp && !events[i].Timestamp.Equal(events[j].Timestamp) {
			return events[i].Timestamp.After(events[j].Timestamp)
		}
		if events[i].HasTimestamp != events[j].HasTimestamp {
			return events[i].HasTimestamp
		}
		return events[i].Order > events[j].Order
	})

	return events, nil
}

func assignCrewTasks(agentOrder []*crewAgentAccumulator, tasks []crewTaskState) {
	for _, agent := range agentOrder {
		for _, task := range tasks {
			if !task.IsClaimed || isTerminalTaskStatus(task.Record.Status) {
				continue
			}
			if task.NormalizedAgentID == agent.NormalizedID || task.NormalizedAssignee == agent.NormalizedName {
				copyTask := task.Record
				agent.CurrentTask = &copyTask
				break
			}
		}
	}
}

func assignCrewFeed(agentOrder []*crewAgentAccumulator, events []crewFeedEvent) {
	byKey := make(map[string]*crewAgentAccumulator)
	for _, agent := range agentOrder {
		for _, key := range []string{agent.NormalizedID, agent.NormalizedName} {
			if key != "" {
				byKey[key] = agent
			}
		}
	}
	now := time.Now()
	for _, event := range events {
		for _, key := range event.AgentKeys {
			agent := byKey[key]
			if agent == nil {
				continue
			}
			agent.FeedEvents = append(agent.FeedEvents, event.Log)
			if event.HasTimestamp && sameLocalDay(now, event.Timestamp) {
				agent.RequestCount++
				switch event.Kind {
				case "task_submit", "task_complete":
					agent.SubmitCount++
				case "task_review", "task_rework":
					agent.ReviewCount++
				}
			}
			break
		}
	}
}

func finalizeCrewSummary(agent *crewAgentAccumulator) {
	if agent.CurrentTask != nil {
		agent.Summary.CurrentSubTask = &crewSubTaskBrief{
			ID:         agent.CurrentTask.ID,
			Name:       agent.CurrentTask.Name,
			ModuleName: agent.CurrentTask.ModuleName,
		}
	}
	recent := make([]crewRecentAction, 0, minInt(5, len(agent.FeedEvents)+1))
	for _, item := range agent.FeedEvents {
		recent = append(recent, crewRecentAction{
			Method:         item.Method,
			Path:           item.Path,
			RequestBody:    item.RequestBody,
			ResponseStatus: item.ResponseStatus,
			Timestamp:      item.Timestamp,
		})
		if len(recent) >= 5 {
			break
		}
	}
	if len(recent) == 0 && agent.Presence == "thinking" {
		recent = append(recent, crewRecentAction{
			Method:      http.MethodGet,
			Path:        "/api/tasks",
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
			RequestBody: "",
		})
	}
	if len(recent) == 0 && agent.Presence == "working" && agent.Summary.CurrentSubTask != nil {
		recent = append(recent, crewRecentAction{
			Method:      http.MethodPost,
			Path:        "/api/sub-tasks/" + agent.Summary.CurrentSubTask.ID + "/start",
			Timestamp:   time.Now().UTC().Format(time.RFC3339),
			RequestBody: "",
		})
	}
	agent.Summary.RecentActions = recent
	if agent.RequestCount > agent.ToolCallCount {
		agent.Summary.TodayRequestCount = agent.RequestCount
	}
	agent.Summary.TodaySubmitCount = agent.SubmitCount
	agent.Summary.TodayReviewCount = agent.ReviewCount
}

func unwrapFeedRecord(rec map[string]any) map[string]any {
	for _, key := range []string{"event", "data", "payload", "record"} {
		if nested := asRecord(rec[key]); len(nested) > 0 {
			return nested
		}
	}
	return rec
}

func extractObjectList(payload any, keys ...string) []map[string]any {
	if direct := asSlice(payload); len(direct) > 0 {
		return mapList(direct)
	}
	rec := asRecord(payload)
	for _, key := range keys {
		if values := asSlice(rec[key]); len(values) > 0 {
			return mapList(values)
		}
	}
	return nil
}

func mapList(items []any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if rec := asRecord(item); len(rec) > 0 {
			out = append(out, rec)
		}
	}
	return out
}

func asRecord(value any) map[string]any {
	rec, _ := value.(map[string]any)
	return rec
}

func asSlice(value any) []any {
	items, _ := value.([]any)
	return items
}

func lookupValue(rec map[string]any, key string) (any, bool) {
	parts := strings.Split(key, ".")
	current := any(rec)
	for _, part := range parts {
		mapValue, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = mapValue[part]
		if !ok {
			return nil, false
		}
	}
	return current, true
}

func firstString(rec map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := lookupValue(rec, key)
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				return trimmed
			}
		case json.Number:
			return typed.String()
		case float64:
			if typed == float64(int64(typed)) {
				return strconv.FormatInt(int64(typed), 10)
			}
		}
	}
	return ""
}

func firstInt(rec map[string]any, keys ...string) int {
	for _, key := range keys {
		value, ok := lookupValue(rec, key)
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int(typed)
		case int:
			return typed
		case int64:
			return int(typed)
		case json.Number:
			parsed, err := typed.Int64()
			if err == nil {
				return int(parsed)
			}
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

func firstHTTPStatus(rec map[string]any, keys ...string) *int {
	for _, key := range keys {
		value, ok := lookupValue(rec, key)
		if !ok {
			continue
		}
		status := 0
		switch typed := value.(type) {
		case float64:
			status = int(typed)
		case int:
			status = typed
		case int64:
			status = int(typed)
		case json.Number:
			parsed, err := typed.Int64()
			if err == nil {
				status = int(parsed)
			}
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			if err == nil {
				status = parsed
			}
		}
		if status >= 100 && status <= 599 {
			return &status
		}
	}
	return nil
}

func flattenStringValues(rec map[string]any, keys ...string) []string {
	out := make([]string, 0)
	for _, key := range keys {
		value, ok := lookupValue(rec, key)
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case []any:
			for _, item := range typed {
				if text, ok := item.(string); ok {
					out = append(out, strings.TrimSpace(text))
					continue
				}
				if nested := asRecord(item); len(nested) > 0 {
					if text := firstString(nested, "id", "task_id", "sub_task_id", "name", "title"); text != "" {
						out = append(out, text)
					}
				}
			}
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				out = append(out, trimmed)
			}
		}
	}
	return out
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func normalizeCrewRole(role string) string {
	trimmed := normalizeToken(role)
	if trimmed == "" {
		return "member"
	}
	if mapped, ok := crewRoleMap[trimmed]; ok {
		return mapped
	}
	return trimmed
}

func normalizeCrewPresence(status string) string {
	trimmed := normalizeToken(status)
	if mapped, ok := crewStatusMap[trimmed]; ok {
		return mapped
	}
	return "idle"
}

func normalizeFeedKind(kind string) string {
	trimmed := normalizeToken(kind)
	trimmed = strings.ReplaceAll(trimmed, ".", "_")
	trimmed = strings.ReplaceAll(trimmed, "-", "_")
	return trimmed
}

func isClaimedTask(status string, rec map[string]any, assignee string) bool {
	normalized := normalizeToken(status)
	if _, ok := crewActiveTaskStates[normalized]; ok {
		return true
	}
	if _, ok := crewTerminalTaskStates[normalized]; ok {
		return false
	}
	if claimed := firstString(rec, "claimed", "is_claimed", "isClaimed"); strings.EqualFold(claimed, "true") {
		return true
	}
	return normalizeToken(assignee) != ""
}

func taskStatusPriority(status string) int {
	normalized := normalizeToken(status)
	if _, ok := crewActiveTaskStates[normalized]; ok {
		if normalized == "in_progress" || normalized == "in-progress" || normalized == "started" || normalized == "working" || normalized == "active" {
			return 3
		}
		return 2
	}
	if _, ok := crewTerminalTaskStates[normalized]; ok {
		return 0
	}
	return 1
}

func isTerminalTaskStatus(status string) bool {
	_, ok := crewTerminalTaskStates[normalizeToken(status)]
	return ok
}

func synthesizeFeedRoute(kind string, rec map[string]any) (string, string) {
	taskID := firstString(rec, "task_id", "taskId", "sub_task_id", "subTaskId", "id")
	subTaskPath := "/api/sub-tasks"
	if taskID != "" {
		subTaskPath += "/" + taskID
	}
	switch kind {
	case "task_create", "create_task", "task_created":
		return http.MethodPost, "/api/tasks"
	case "task_claim", "claim_task", "task_claimed":
		return http.MethodPost, subTaskPath + "/claim"
	case "task_start", "start_task", "task_started":
		return http.MethodPost, subTaskPath + "/start"
	case "task_submit", "submit_task", "task_submitted":
		return http.MethodPost, subTaskPath + "/submit"
	case "task_review", "review_task", "task_reviewed":
		return http.MethodPost, "/api/review-records"
	case "task_complete", "complete_task", "task_completed":
		return http.MethodPost, subTaskPath + "/complete"
	case "task_rework", "rework_task", "task_reworked", "task_failed", "task_timeout", "failed", "timeout":
		return http.MethodPost, subTaskPath + "/rework"
	case "thinking", "query", "lookup", "idle":
		return http.MethodGet, "/api/tasks"
	default:
		if kind == "" {
			return "EVENT", "/events/unknown"
		}
		return "EVENT", "/events/" + kind
	}
}

func buildFeedRequestBody(rec map[string]any, kind string) string {
	if raw, ok := lookupValue(rec, "request_body"); ok {
		return stringifyJSONValue(raw)
	}
	if raw, ok := lookupValue(rec, "requestBody"); ok {
		return stringifyJSONValue(raw)
	}
	body := map[string]any{}
	if name := firstString(rec, "name", "task_name", "taskName", "title", "summary"); name != "" {
		body["name"] = name
	}
	if score, ok := lookupValue(rec, "score"); ok {
		body["score"] = score
	}
	if comment := firstString(rec, "comment", "reason", "message", "detail"); comment != "" {
		if kind == "task_rework" {
			body["reason"] = comment
		} else {
			body["comment"] = comment
		}
	}
	if result := firstString(rec, "result", "decision", "status"); result != "" && kind == "task_review" {
		body["result"] = result
	}
	if len(body) == 0 {
		return ""
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func stringifyJSONValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case nil:
		return ""
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(encoded)
	}
}

func parseFlexibleTime(raw string) (time.Time, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05", "2006-01-02 15:04:05.999999999", time.DateTime} {
		if ts, err := time.Parse(layout, trimmed); err == nil {
			return ts, true
		}
	}
	if unixValue, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		if len(trimmed) >= 13 {
			return time.UnixMilli(unixValue), true
		}
		return time.Unix(unixValue, 0), true
	}
	return time.Time{}, false
}

func normalizeTimeString(raw string, parsed time.Time, ok bool) string {
	if ok {
		return parsed.UTC().Format(time.RFC3339)
	}
	return strings.TrimSpace(raw)
}

func normalizeToken(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func nullableString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeWaveValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case float64:
		if typed == float64(int64(typed)) {
			return int(typed)
		}
		return typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return nil
		}
		if parsed, err := strconv.Atoi(trimmed); err == nil {
			return parsed
		}
		return trimmed
	default:
		return typed
	}
}

func sameLocalDay(a, b time.Time) bool {
	a = a.In(time.Local)
	b = b.In(time.Local)
	y1, m1, d1 := a.Date()
	y2, m2, d2 := b.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
