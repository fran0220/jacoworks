package agent

// EventCallback is invoked for key WebSocket lifecycle events.
type EventCallback func(userID, event string, properties map[string]interface{})
