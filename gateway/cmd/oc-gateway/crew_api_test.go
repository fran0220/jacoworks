package main

import "testing"

func TestParseCrewRegistryMapsRolesAndPresence(t *testing.T) {
	registry := `{"registry":[{"id":"agent-1","name":"Planner","role":"crew-planner","status":"idle","toolCallCount":7},{"name":"Worker","role":"crew-worker","status":"active"}]}`
	_, order, err := parseCrewRegistry(registry)
	if err != nil {
		t.Fatalf("parseCrewRegistry: %v", err)
	}
	if len(order) != 2 {
		t.Fatalf("expected 2 agents, got %d", len(order))
	}
	if got := order[0].Summary.Role; got != "planner" {
		t.Fatalf("expected planner role, got %q", got)
	}
	if got := order[0].Summary.PresenceState; got != "thinking" {
		t.Fatalf("expected idle registry status to map to thinking, got %q", got)
	}
	if got := order[1].Summary.Role; got != "executor" {
		t.Fatalf("expected executor role, got %q", got)
	}
}

func TestParseCrewFeedSynthesizesTaskRoutes(t *testing.T) {
	feed := "{\"type\":\"task_start\",\"agent_name\":\"Worker\",\"task_id\":\"task-9\",\"timestamp\":\"2026-04-06T10:00:00Z\"}\n"
	events, err := parseCrewFeed(feed)
	if err != nil {
		t.Fatalf("parseCrewFeed: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if got := events[0].Log.Method; got != "POST" {
		t.Fatalf("expected POST method, got %q", got)
	}
	if got := events[0].Log.Path; got != "/api/sub-tasks/task-9/start" {
		t.Fatalf("expected synthesized task route, got %q", got)
	}
}

func TestParseCrewTasksExtractsDependencies(t *testing.T) {
	body := `{"tasks":[{"id":"task-a","name":"Plan","status":"claimed","claimed_by":"Planner","module_name":"core"},{"id":"task-b","name":"Ship","status":"todo","depends_on":["task-a"]}]}`
	tasks, deps, err := parseCrewTasks(body)
	if err != nil {
		t.Fatalf("parseCrewTasks: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(tasks))
	}
	if !tasks[0].Record.Claimed {
		t.Fatal("expected claimed task to stay marked as claimed")
	}
	if tasks[0].Record.ModuleName == nil || *tasks[0].Record.ModuleName != "core" {
		t.Fatal("expected module name to be preserved")
	}
	if len(deps) != 1 || deps[0].From != "task-a" || deps[0].To != "task-b" {
		t.Fatalf("unexpected dependencies: %+v", deps)
	}
}
