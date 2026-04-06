package scheduler

import (
	"sync"
	"time"
)

type ActivityEvent struct {
	Kind      string `json:"kind"`
	TaskID    string `json:"taskId"`
	AgentID   string `json:"agentId"`
	AgentName string `json:"agentName"`
	Detail    string `json:"detail"`
	Timestamp string `json:"ts"`
}

type EventBus struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan ActivityEvent]struct{}
}

func NewEventBus() *EventBus {
	return &EventBus{
		subscribers: make(map[string]map[chan ActivityEvent]struct{}),
	}
}

func (eb *EventBus) Subscribe(userID string) (<-chan ActivityEvent, func()) {
	ch := make(chan ActivityEvent, 32)

	eb.mu.Lock()
	if _, ok := eb.subscribers[userID]; !ok {
		eb.subscribers[userID] = make(map[chan ActivityEvent]struct{})
	}
	eb.subscribers[userID][ch] = struct{}{}
	eb.mu.Unlock()

	unsubscribe := func() {
		eb.mu.Lock()
		defer eb.mu.Unlock()

		userSubs, ok := eb.subscribers[userID]
		if !ok {
			return
		}
		if _, ok := userSubs[ch]; !ok {
			return
		}
		delete(userSubs, ch)
		if len(userSubs) == 0 {
			delete(eb.subscribers, userID)
		}
		close(ch)
	}

	return ch, unsubscribe
}

func (eb *EventBus) Publish(userID string, event ActivityEvent) {
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	eb.mu.RLock()
	defer eb.mu.RUnlock()

	for ch := range eb.subscribers[userID] {
		select {
		case ch <- event:
		default:
		}
	}
}
