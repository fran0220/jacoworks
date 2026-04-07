package task

import "testing"

func TestValidateTransition_Valid(t *testing.T) {
	tests := []struct {
		from string
		to   string
	}{
		{from: StatusPending, to: StatusAssigned},
		{from: StatusAssigned, to: StatusRunning},
		{from: StatusAssigned, to: StatusFailed},
		{from: StatusRunning, to: StatusDone},
		{from: StatusRunning, to: StatusFailed},
		{from: StatusRunning, to: StatusTimeout},
		{from: StatusFailed, to: StatusPending},
		{from: StatusTimeout, to: StatusPending},
	}

	for _, tc := range tests {
		if err := ValidateTransition(tc.from, tc.to); err != nil {
			t.Fatalf("expected %s -> %s to be valid, got error: %v", tc.from, tc.to, err)
		}
	}
}

func TestValidateTransition_Invalid(t *testing.T) {
	tests := []struct {
		from string
		to   string
	}{
		{from: StatusPending, to: StatusRunning},
		{from: StatusDone, to: StatusPending},
		{from: StatusRunning, to: StatusAssigned},
	}

	for _, tc := range tests {
		if err := ValidateTransition(tc.from, tc.to); err == nil {
			t.Fatalf("expected %s -> %s to be invalid", tc.from, tc.to)
		}
	}
}

func TestValidateTransition_UnknownSource(t *testing.T) {
	if err := ValidateTransition("unknown", StatusPending); err == nil {
		t.Fatal("expected unknown status to return error")
	}
}
