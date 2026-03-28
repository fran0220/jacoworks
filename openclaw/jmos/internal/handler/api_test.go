package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/rs/zerolog"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/config"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/handler"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/service"
	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

// testEnv holds a running test server and test constants.
type testEnv struct {
	server   *httptest.Server
	adminPwd string
	regToken string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dir := t.TempDir()

	cfg := &config.Config{
		Project:  config.ProjectConfig{Name: "test"},
		Admin:    config.AdminConfig{Password: "test-admin-pwd"},
		Agent:    config.AgentConfig{RegistrationToken: "test-reg-token", AllowRegistration: true},
		Server:   config.ServerConfig{Port: 0, Host: "127.0.0.1"},
		Database: config.DatabaseConfig{Type: "sqlite", Path: filepath.Join(dir, "test.db")},
		WebUI:    config.WebUIConfig{FeedRetentionDays: 7},
	}

	db, err := store.Open(cfg.Database.Path)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	log := zerolog.New(os.Stderr).Level(zerolog.Disabled)

	eventSvc := service.NewEventService(db)
	agentSvc := service.NewAgentService(db)
	taskSvc := service.NewTaskService(db)
	rewardSvc := service.NewRewardService(db)
	subTaskSvc := service.NewSubTaskService(db, eventSvc)
	reviewSvc := service.NewReviewService(db, subTaskSvc, rewardSvc, eventSvc)
	ruleSvc := service.NewRuleService(db, cfg)
	patrolSvc := service.NewPatrolService(db, eventSvc)
	spaceSvc := service.NewSpaceService(db)

	router := handler.NewRouter(
		cfg, db, log,
		agentSvc, taskSvc, subTaskSvc, reviewSvc, rewardSvc,
		eventSvc, ruleSvc, patrolSvc, spaceSvc,
	)

	srv := httptest.NewServer(router)
	t.Cleanup(func() { srv.Close() })

	return &testEnv{server: srv, adminPwd: "test-admin-pwd", regToken: "test-reg-token"}
}

// --- HTTP helpers ---

func (e *testEnv) url(path string) string { return e.server.URL + path }

func (e *testEnv) doJSON(t *testing.T, method, path string, body any, headers map[string]string) (int, map[string]any) {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, e.url(path), r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var result map[string]any
	json.Unmarshal(data, &result)
	return resp.StatusCode, result
}

func (e *testEnv) doJSONList(t *testing.T, method, path string, body any, headers map[string]string) (int, []any) {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, e.url(path), r)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	var result []any
	json.Unmarshal(data, &result)
	return resp.StatusCode, result
}

func bearerHeader(apiKey string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + apiKey}
}

func adminHeader(pwd string) map[string]string {
	return map[string]string{"X-Admin-Token": pwd}
}

func adminLogin(t *testing.T, env *testEnv) map[string]string {
	t.Helper()
	code, body := env.doJSON(t, "POST", "/api/v1/admin/login",
		map[string]string{"password": env.adminPwd}, nil)
	if code != 200 {
		t.Fatalf("admin login failed: %d %v", code, body)
	}
	token, _ := body["token"].(string)
	if token == "" {
		t.Fatal("expected admin session token")
	}
	return adminHeader(token)
}

// --- Tests ---

func TestHealthCheck(t *testing.T) {
	env := newTestEnv(t)
	code, body := env.doJSON(t, "GET", "/api/v1/health", nil, nil)
	if code != 200 {
		t.Fatalf("expected 200, got %d", code)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", body["status"])
	}
}

func TestHealthCheckLegacyRoute(t *testing.T) {
	env := newTestEnv(t)
	code, body := env.doJSON(t, "GET", "/api/health", nil, nil)
	if code != 200 {
		t.Fatalf("expected 200 on legacy /api/health, got %d", code)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok")
	}
}

func TestAgentRegistration(t *testing.T) {
	env := newTestEnv(t)

	// Missing token → 401
	code, _ := env.doJSON(t, "POST", "/api/v1/agents/register",
		map[string]string{"name": "planner-1", "role": "planner"},
		nil,
	)
	if code != 401 {
		t.Fatalf("expected 401 without token, got %d", code)
	}

	// Wrong token → 401
	code, _ = env.doJSON(t, "POST", "/api/v1/agents/register",
		map[string]string{"name": "planner-1", "role": "planner"},
		map[string]string{"X-Registration-Token": "wrong"},
	)
	if code != 401 {
		t.Fatalf("expected 401 with wrong token, got %d", code)
	}

	// Valid registration → 201
	code, body := env.doJSON(t, "POST", "/api/v1/agents/register",
		map[string]string{"name": "planner-1", "role": "planner"},
		map[string]string{"X-Registration-Token": env.regToken},
	)
	if code != 201 {
		t.Fatalf("expected 201, got %d: %v", code, body)
	}
	if body["api_key"] == nil || body["api_key"].(string) == "" {
		t.Fatal("expected api_key in response")
	}

	// Duplicate name → 201 idempotent
	code, body = env.doJSON(t, "POST", "/api/v1/agents/register",
		map[string]string{"name": "planner-1", "role": "planner"},
		map[string]string{"X-Registration-Token": env.regToken},
	)
	if code != 201 {
		t.Fatalf("expected 201 for duplicate registration, got %d", code)
	}
	if body["id"] == nil || body["api_key"] == nil {
		t.Fatalf("expected existing agent payload, got %v", body)
	}
}

// registerAgent is a test helper to create an agent and return its api_key.
func registerAgent(t *testing.T, env *testEnv, name, role string) string {
	t.Helper()
	code, body := env.doJSON(t, "POST", "/api/v1/agents/register",
		map[string]string{"name": name, "role": role},
		map[string]string{"X-Registration-Token": env.regToken},
	)
	if code != 201 {
		t.Fatalf("register %s failed: %d %v", name, code, body)
	}
	return body["api_key"].(string)
}

func TestFullWorkflow(t *testing.T) {
	env := newTestEnv(t)

	// Step 1: Register four agents
	plannerKey := registerAgent(t, env, "规划师", "planner")
	executorKey := registerAgent(t, env, "执行者", "executor")
	reviewerKey := registerAgent(t, env, "审查者", "reviewer")
	patrolKey := registerAgent(t, env, "巡查者", "patrol")
	_ = patrolKey

	// Step 2: Verify agent list
	code, agentList := env.doJSONList(t, "GET", "/api/v1/agents", nil, bearerHeader(plannerKey))
	if code != 200 {
		t.Fatalf("list agents: %d", code)
	}
	if len(agentList) != 4 {
		t.Fatalf("expected 4 agents, got %d", len(agentList))
	}

	// Step 3: Planner creates a task
	code, task := env.doJSON(t, "POST", "/api/v1/tasks",
		map[string]string{"name": "实现用户认证", "description": "JWT + 会话管理"},
		bearerHeader(plannerKey),
	)
	if code != 201 {
		t.Fatalf("create task: %d %v", code, task)
	}
	taskID := task["id"].(string)

	// Step 4: Planner creates a sub-task assigned to executor
	// First get executor's agent ID
	executorID := ""
	for _, a := range agentList {
		agent := a.(map[string]any)
		if agent["name"] == "执行者" {
			executorID = agent["id"].(string)
		}
	}
	if executorID == "" {
		t.Fatal("executor not found")
	}

	code, subTask := env.doJSON(t, "POST", "/api/v1/sub-tasks",
		map[string]any{
			"task_id":        taskID,
			"name":           "实现登录接口",
			"description":    "POST /api/auth/login",
			"priority":       "high",
			"assigned_agent": executorID,
		},
		bearerHeader(plannerKey),
	)
	if code != 201 {
		t.Fatalf("create sub-task: %d %v", code, subTask)
	}
	subTaskID := subTask["id"].(string)

	// Sub-task should be in "assigned" status (auto-assigned)
	if subTask["status"] != "assigned" {
		t.Fatalf("expected status=assigned, got %v", subTask["status"])
	}

	// Step 5: Executor starts the sub-task
	code, started := env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/start", subTaskID),
		map[string]string{"session_id": "sess-001"},
		bearerHeader(executorKey),
	)
	if code != 200 {
		t.Fatalf("start sub-task: %d %v", code, started)
	}
	if started["status"] != "in_progress" {
		t.Fatalf("expected status=in_progress, got %v", started["status"])
	}

	// Step 6: Executor submits for review
	code, submitted := env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/submit", subTaskID),
		nil, bearerHeader(executorKey),
	)
	if code != 200 {
		t.Fatalf("submit sub-task: %d %v", code, submitted)
	}
	if submitted["status"] != "review" {
		t.Fatalf("expected status=review, got %v", submitted["status"])
	}

	// Step 7: Reviewer approves with score 5
	code, review := env.doJSON(t, "POST", "/api/v1/reviews",
		map[string]any{
			"sub_task_id": subTaskID,
			"result":      "approved",
			"score":       5,
			"comment":     "优秀的实现",
		},
		bearerHeader(reviewerKey),
	)
	if code != 201 {
		t.Fatalf("create review: %d %v", code, review)
	}

	// Step 8: Verify sub-task is now done
	code, done := env.doJSON(t, "GET", fmt.Sprintf("/api/v1/sub-tasks/%s", subTaskID),
		nil, bearerHeader(plannerKey),
	)
	if code != 200 {
		t.Fatalf("get sub-task: %d", code)
	}
	if done["status"] != "done" {
		t.Fatalf("expected status=done after approval, got %v", done["status"])
	}

	// Step 9: Verify events were generated
	code, events := env.doJSON(t, "GET", "/api/v1/events?after_seq=0&limit=100",
		nil, bearerHeader(plannerKey),
	)
	if code != 200 {
		t.Fatalf("list events: %d", code)
	}
	eventItems, ok := events["events"].([]any)
	if !ok || len(eventItems) == 0 {
		t.Fatalf("expected events from workflow, got %v", events)
	}
	// Should have: start, submit, review/approve events
	if len(eventItems) < 3 {
		t.Fatalf("expected at least 3 events, got %d", len(eventItems))
	}

	// Step 10: Verify space graph
	code, graph := env.doJSON(t, "GET", "/api/v1/space/graph", nil, nil)
	if code != 200 {
		t.Fatalf("space graph: %d", code)
	}
	nodes, _ := graph["nodes"].([]any)
	if len(nodes) != 4 {
		t.Fatalf("expected 4 nodes in graph, got %d", len(nodes))
	}

	// Step 11: Verify pulse
	code, _ = env.doJSONList(t, "GET", "/api/v1/space/pulse", nil, nil)
	if code != 200 {
		t.Fatalf("space pulse: %d", code)
	}

	// Step 12: Verify stats overview
	code, overview := env.doJSON(t, "GET", "/api/v1/stats/overview", nil, nil)
	if code != 200 {
		t.Fatalf("stats overview: %d", code)
	}
	if overview["total_tasks"] == nil {
		t.Fatal("expected total_tasks in overview")
	}

	// Step 13: Verify score leaderboard (returns array directly)
	code, leaders := env.doJSONList(t, "GET", "/api/v1/scores/leaderboard",
		nil, bearerHeader(plannerKey),
	)
	if code != 200 {
		t.Fatalf("leaderboard: %d", code)
	}
	if len(leaders) == 0 {
		t.Fatal("expected leaderboard entries")
	}
}

func TestReworkFlow(t *testing.T) {
	env := newTestEnv(t)

	plannerKey := registerAgent(t, env, "planner", "planner")
	executorKey := registerAgent(t, env, "executor", "executor")
	reviewerKey := registerAgent(t, env, "reviewer", "reviewer")

	// Get executor ID
	_, agentList := env.doJSONList(t, "GET", "/api/v1/agents", nil, bearerHeader(plannerKey))
	executorID := ""
	for _, a := range agentList {
		agent := a.(map[string]any)
		if agent["name"] == "executor" {
			executorID = agent["id"].(string)
		}
	}

	// Create task + sub-task
	_, task := env.doJSON(t, "POST", "/api/v1/tasks",
		map[string]string{"name": "test-task"}, bearerHeader(plannerKey))
	taskID := task["id"].(string)

	_, subTask := env.doJSON(t, "POST", "/api/v1/sub-tasks",
		map[string]any{"task_id": taskID, "name": "rework-test", "assigned_agent": executorID},
		bearerHeader(plannerKey))
	stID := subTask["id"].(string)

	// Start → submit
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/start", stID), nil, bearerHeader(executorKey))
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/submit", stID), nil, bearerHeader(executorKey))

	// Reviewer rejects → rework
	code, review := env.doJSON(t, "POST", "/api/v1/reviews",
		map[string]any{
			"sub_task_id": stID,
			"result":      "rejected",
			"score":       2,
			"issues":      "变量命名不规范",
			"comment":     "需要改进",
		},
		bearerHeader(reviewerKey),
	)
	if code != 201 {
		t.Fatalf("create reject review: %d %v", code, review)
	}

	// Verify sub-task is in rework
	_, st := env.doJSON(t, "GET", fmt.Sprintf("/api/v1/sub-tasks/%s", stID), nil, bearerHeader(plannerKey))
	if st["status"] != "rework" {
		t.Fatalf("expected rework, got %v", st["status"])
	}
	if st["rework_count"].(float64) != 1 {
		t.Fatalf("expected rework_count=1, got %v", st["rework_count"])
	}

	// Executor re-starts → submit → reviewer approves
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/start", stID), nil, bearerHeader(executorKey))
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/submit", stID), nil, bearerHeader(executorKey))

	code, _ = env.doJSON(t, "POST", "/api/v1/reviews",
		map[string]any{"sub_task_id": stID, "result": "approved", "score": 4, "comment": "好多了"},
		bearerHeader(reviewerKey),
	)
	if code != 201 {
		t.Fatalf("approve after rework: %d", code)
	}

	_, st = env.doJSON(t, "GET", fmt.Sprintf("/api/v1/sub-tasks/%s", stID), nil, bearerHeader(plannerKey))
	if st["status"] != "done" {
		t.Fatalf("expected done, got %v", st["status"])
	}
}

func TestBlockAndReassign(t *testing.T) {
	env := newTestEnv(t)

	plannerKey := registerAgent(t, env, "planner", "planner")
	exec1Key := registerAgent(t, env, "exec1", "executor")
	registerAgent(t, env, "exec2", "executor")
	patrolKey := registerAgent(t, env, "patrol", "patrol")

	// Get agent IDs
	_, agentList := env.doJSONList(t, "GET", "/api/v1/agents", nil, bearerHeader(plannerKey))
	ids := map[string]string{}
	for _, a := range agentList {
		agent := a.(map[string]any)
		ids[agent["name"].(string)] = agent["id"].(string)
	}

	// Create task + sub-task assigned to exec1
	_, task := env.doJSON(t, "POST", "/api/v1/tasks",
		map[string]string{"name": "block-test"}, bearerHeader(plannerKey))
	taskID := task["id"].(string)

	_, st := env.doJSON(t, "POST", "/api/v1/sub-tasks",
		map[string]any{"task_id": taskID, "name": "block-task", "assigned_agent": ids["exec1"]},
		bearerHeader(plannerKey))
	stID := st["id"].(string)

	// Start
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/start", stID), nil, bearerHeader(exec1Key))

	// Patrol blocks
	code, blocked := env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/block", stID),
		nil, bearerHeader(patrolKey))
	if code != 200 {
		t.Fatalf("block: %d %v", code, blocked)
	}
	if blocked["status"] != "blocked" {
		t.Fatalf("expected blocked, got %v", blocked["status"])
	}

	// Planner reassigns to exec2
	code, reassigned := env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/reassign", stID),
		map[string]string{"agent_id": ids["exec2"]},
		bearerHeader(plannerKey))
	if code != 200 {
		t.Fatalf("reassign: %d %v", code, reassigned)
	}
	if reassigned["status"] != "assigned" {
		t.Fatalf("expected assigned, got %v", reassigned["status"])
	}
}

func TestAdminLogin(t *testing.T) {
	env := newTestEnv(t)

	// Wrong password → 401
	code, _ := env.doJSON(t, "POST", "/api/v1/admin/login",
		map[string]string{"password": "wrong"}, nil)
	if code != 401 {
		t.Fatalf("expected 401, got %d", code)
	}

	// Correct password → 200
	code, body := env.doJSON(t, "POST", "/api/v1/admin/login",
		map[string]string{"password": env.adminPwd}, nil)
	if code != 200 {
		t.Fatalf("expected 200, got %d: %v", code, body)
	}
	token, _ := body["token"].(string)
	if token == "" {
		t.Fatal("expected session token")
	}
	if token == env.adminPwd {
		t.Fatal("expected session token to differ from admin password")
	}
}

func TestAdminAgentCRUD(t *testing.T) {
	env := newTestEnv(t)
	admin := adminLogin(t, env)

	// Admin creates agent
	code, agent := env.doJSON(t, "POST", "/api/v1/agents",
		map[string]string{"name": "admin-created", "role": "executor"}, admin)
	if code != 201 {
		t.Fatalf("admin create agent: %d %v", code, agent)
	}
	agentID := agent["id"].(string)

	// Admin lists agents (returns array, not paginated)
	code, agents := env.doJSONList(t, "GET", "/api/v1/admin/agents", nil, admin)
	if code != 200 {
		t.Fatalf("admin list agents: %d", code)
	}
	if len(agents) != 1 {
		t.Fatalf("expected 1 agent, got %d", len(agents))
	}

	// Admin resets key
	code, newKey := env.doJSON(t, "POST", fmt.Sprintf("/api/v1/admin/agents/%s/reset-key", agentID), nil, admin)
	if code != 200 {
		t.Fatalf("reset key: %d %v", code, newKey)
	}
	if newKey["api_key"] == nil {
		t.Fatal("expected new api_key")
	}
}

func TestReviewRecordsLegacyRoute(t *testing.T) {
	env := newTestEnv(t)

	plannerKey := registerAgent(t, env, "planner", "planner")
	executorKey := registerAgent(t, env, "executor", "executor")
	reviewerKey := registerAgent(t, env, "reviewer", "reviewer")

	_, task := env.doJSON(t, "POST", "/api/v1/tasks",
		map[string]string{"name": "兼容审查接口", "description": "验证 review-records 别名"},
		bearerHeader(plannerKey),
	)
	taskID := task["id"].(string)

	_, subTask := env.doJSON(t, "POST", "/api/v1/sub-tasks",
		map[string]string{"task_id": taskID, "name": "实现兼容接口", "description": "补 review-records"},
		bearerHeader(plannerKey),
	)
	subTaskID := subTask["id"].(string)

	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/claim", subTaskID), nil, bearerHeader(executorKey))
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/start", subTaskID), nil, bearerHeader(executorKey))
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/submit", subTaskID), nil, bearerHeader(executorKey))

	code, review := env.doJSON(t, "POST", "/api/v1/review-records",
		map[string]any{
			"sub_task_id": subTaskID,
			"result":      "approved",
			"score":       5,
			"comment":     "legacy route works",
		},
		bearerHeader(reviewerKey),
	)
	if code != 201 {
		t.Fatalf("legacy review create: %d %v", code, review)
	}

	code, list := env.doJSON(t, "GET", "/api/v1/review-records?sub_task_id="+subTaskID, nil, bearerHeader(reviewerKey))
	if code != 200 {
		t.Fatalf("legacy review list: %d %v", code, list)
	}
	items, ok := list["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("expected legacy review list items, got %v", list)
	}
}

func TestInvalidStateMachineTransitions(t *testing.T) {
	env := newTestEnv(t)

	plannerKey := registerAgent(t, env, "planner", "planner")
	executorKey := registerAgent(t, env, "executor", "executor")

	_, agentList := env.doJSONList(t, "GET", "/api/v1/agents", nil, bearerHeader(plannerKey))
	executorID := ""
	for _, a := range agentList {
		agent := a.(map[string]any)
		if agent["name"] == "executor" {
			executorID = agent["id"].(string)
		}
	}

	_, task := env.doJSON(t, "POST", "/api/v1/tasks",
		map[string]string{"name": "state-test"}, bearerHeader(plannerKey))
	taskID := task["id"].(string)

	_, st := env.doJSON(t, "POST", "/api/v1/sub-tasks",
		map[string]any{"task_id": taskID, "name": "invalid-transition", "assigned_agent": executorID},
		bearerHeader(plannerKey))
	stID := st["id"].(string)

	// Cannot submit from assigned (must start first)
	code, _ := env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/submit", stID),
		nil, bearerHeader(executorKey))
	if code != 400 {
		t.Fatalf("submit from assigned should be 400, got %d", code)
	}

	// Start → in_progress
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/start", stID), nil, bearerHeader(executorKey))

	// Cannot claim from in_progress
	code, _ = env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/claim", stID),
		nil, bearerHeader(executorKey))
	if code != 400 {
		t.Fatalf("claim from in_progress should be 400, got %d", code)
	}
}

func TestRoleBasedAccess(t *testing.T) {
	env := newTestEnv(t)

	executorKey := registerAgent(t, env, "executor", "executor")

	// Executor cannot create tasks (requires planner)
	code, _ := env.doJSON(t, "POST", "/api/v1/tasks",
		map[string]string{"name": "should-fail"},
		bearerHeader(executorKey))
	if code != 403 {
		t.Fatalf("executor creating task should be 403, got %d", code)
	}

	// Executor cannot create sub-tasks (requires planner)
	code, _ = env.doJSON(t, "POST", "/api/v1/sub-tasks",
		map[string]any{"task_id": "fake", "name": "should-fail"},
		bearerHeader(executorKey))
	if code != 403 {
		t.Fatalf("executor creating sub-task should be 403, got %d", code)
	}
}

func TestEventIncrementalPolling(t *testing.T) {
	env := newTestEnv(t)

	plannerKey := registerAgent(t, env, "planner", "planner")
	executorKey := registerAgent(t, env, "executor", "executor")

	_, agents := env.doJSONList(t, "GET", "/api/v1/agents", nil, bearerHeader(plannerKey))
	executorID := ""
	for _, a := range agents {
		agent := a.(map[string]any)
		if agent["name"] == "executor" {
			executorID = agent["id"].(string)
		}
	}

	_, task := env.doJSON(t, "POST", "/api/v1/tasks",
		map[string]string{"name": "event-test"}, bearerHeader(plannerKey))
	taskID := task["id"].(string)

	_, st := env.doJSON(t, "POST", "/api/v1/sub-tasks",
		map[string]any{"task_id": taskID, "name": "event-sub", "assigned_agent": executorID},
		bearerHeader(plannerKey))
	stID := st["id"].(string)

	// Get events before any actions
	_, before := env.doJSON(t, "GET", "/api/v1/events?after_seq=0&limit=100",
		nil, bearerHeader(plannerKey))
	beforeItems, _ := before["events"].([]any)
	beforeCount := len(beforeItems)

	// Start sub-task → generates event
	env.doJSON(t, "POST", fmt.Sprintf("/api/v1/sub-tasks/%s/start", stID), nil, bearerHeader(executorKey))

	// Poll with after_seq=0 → should have more events
	_, after := env.doJSON(t, "GET", "/api/v1/events?after_seq=0&limit=100",
		nil, bearerHeader(plannerKey))
	afterItems, _ := after["events"].([]any)

	if len(afterItems) <= beforeCount {
		t.Fatalf("expected new events after start, before=%d after=%d", beforeCount, len(afterItems))
	}

	// Get the last seq and poll with it → should return nothing new
	lastEvent := afterItems[len(afterItems)-1].(map[string]any)
	lastSeq := int(lastEvent["seq"].(float64))

	_, empty := env.doJSON(t, "GET", fmt.Sprintf("/api/v1/events?after_seq=%d&limit=100", lastSeq),
		nil, bearerHeader(plannerKey))
	emptyItems, _ := empty["events"].([]any)
	if len(emptyItems) != 0 {
		t.Fatalf("expected 0 events after last seq, got %d", len(emptyItems))
	}
}

func TestPatrolReport(t *testing.T) {
	env := newTestEnv(t)

	patrolKey := registerAgent(t, env, "patrol", "patrol")

	code, report := env.doJSON(t, "POST", "/api/v1/patrol/report",
		map[string]any{
			"type":        "timeout",
			"severity":    "warning",
			"description": "子任务超时 30 分钟",
		},
		bearerHeader(patrolKey),
	)
	if code != 201 {
		t.Fatalf("patrol report: %d %v", code, report)
	}

	// Check active patrols (returns array directly)
	code, activeList := env.doJSONList(t, "GET", "/api/v1/patrol/active", nil, bearerHeader(patrolKey))
	if code != 200 {
		t.Fatalf("patrol active: %d", code)
	}
	if len(activeList) != 1 {
		t.Fatalf("expected 1 active patrol, got %d", len(activeList))
	}
}

func TestFeedEndpoints(t *testing.T) {
	env := newTestEnv(t)

	// Feed endpoints are public (no auth)
	code, _ := env.doJSON(t, "GET", "/api/v1/feed/status", nil, nil)
	if code != 200 {
		t.Fatalf("feed status: %d", code)
	}

	code, _ = env.doJSON(t, "GET", "/api/v1/feed/agent-summary", nil, nil)
	if code != 200 {
		t.Fatalf("feed agent-summary: %d", code)
	}
}
