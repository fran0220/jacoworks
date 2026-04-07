package task

import "fmt"

const (
	StatusPending  = "pending"
	StatusAssigned = "assigned"
	StatusRunning  = "running"
	StatusDone     = "done"
	StatusFailed   = "failed"
	StatusTimeout  = "timeout"
)

var validTransitions = map[string][]string{
	StatusPending:  {StatusAssigned},
	StatusAssigned: {StatusRunning, StatusFailed},
	StatusRunning:  {StatusDone, StatusFailed, StatusTimeout},
	StatusFailed:   {StatusPending},
	StatusTimeout:  {StatusPending},
}

func ValidateTransition(from, to string) error {
	targets, ok := validTransitions[from]
	if !ok {
		return fmt.Errorf("unknown status %q", from)
	}
	for _, target := range targets {
		if target == to {
			return nil
		}
	}
	return fmt.Errorf("invalid transition %s -> %s", from, to)
}
