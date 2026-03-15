package agent

// Event is the unit of data stored in the ring buffer and sent to SSE/WS clients.
type Event struct {
	Seq   uint64
	Event string // event type: "session_event", "response", "done", "error", etc.
	Data  []byte // raw JSON
}

// ContainerBackend abstracts container lifecycle operations.
type ContainerBackend interface {
	Start(name string) error
	Unfreeze(name string) error
	Status(name string) (string, error)
	WaitForHealth(name, ip string) error
	// Reprovision recreates a container that was destroyed.
	// Returns the new IP address.
	Reprovision(name, userID, token string, envVars map[string]string, hostPort int) (string, error)
}

// Freezer interface abstracts idle container management.
type Freezer interface {
	Touch(containerName string)
}
