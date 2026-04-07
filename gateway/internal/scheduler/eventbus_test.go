package scheduler

import (
	"testing"
	"time"
)

func TestEventBusPublishSubscribe(t *testing.T) {
	bus := NewEventBus()
	events, unsubscribe := bus.Subscribe("user-1")
	defer unsubscribe()

	bus.Publish("user-1", ActivityEvent{
		Kind:    "task_create",
		TaskID:  "task-1",
		AgentID: "researcher",
		Detail:  "collect references",
	})

	select {
	case ev := <-events:
		if ev.Kind != "task_create" {
			t.Fatalf("unexpected kind: %s", ev.Kind)
		}
		if ev.TaskID != "task-1" {
			t.Fatalf("unexpected task id: %s", ev.TaskID)
		}
		if ev.Timestamp == "" {
			t.Fatal("timestamp should be set")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected event to be delivered")
	}
}

func TestEventBusIsolationByUser(t *testing.T) {
	bus := NewEventBus()
	user1Events, unsubUser1 := bus.Subscribe("user-1")
	defer unsubUser1()
	user2Events, unsubUser2 := bus.Subscribe("user-2")
	defer unsubUser2()

	bus.Publish("user-2", ActivityEvent{Kind: "task_claim", TaskID: "task-2"})

	select {
	case <-user1Events:
		t.Fatal("user-1 must not receive user-2 event")
	case <-time.After(150 * time.Millisecond):
	}

	select {
	case ev := <-user2Events:
		if ev.TaskID != "task-2" {
			t.Fatalf("unexpected task id: %s", ev.TaskID)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("expected user-2 event")
	}
}
