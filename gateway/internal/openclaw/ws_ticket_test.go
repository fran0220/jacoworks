package openclaw

import (
	"errors"
	"testing"
	"time"
)

func TestCreateTicket(t *testing.T) {
	t.Parallel()

	store := NewTicketStore(time.Minute)
	t.Cleanup(store.Close)

	ticket, err := store.CreateTicket("user-1")
	if err != nil {
		t.Fatalf("CreateTicket() error = %v", err)
	}
	if ticket == "" {
		t.Fatalf("CreateTicket() returned empty ticket")
	}
}

func TestValidateTicket_ValidTicket(t *testing.T) {
	t.Parallel()

	store := NewTicketStore(time.Minute)
	t.Cleanup(store.Close)

	ticket, err := store.CreateTicket("user-2")
	if err != nil {
		t.Fatalf("CreateTicket() error = %v", err)
	}

	userID, err := store.ValidateTicket(ticket)
	if err != nil {
		t.Fatalf("ValidateTicket() error = %v", err)
	}
	if userID != "user-2" {
		t.Fatalf("user id = %q, want %q", userID, "user-2")
	}
}

func TestValidateTicket_ExpiredTicket(t *testing.T) {
	t.Parallel()

	store := NewTicketStore(10 * time.Millisecond)
	t.Cleanup(store.Close)

	ticket, err := store.CreateTicket("user-expired")
	if err != nil {
		t.Fatalf("CreateTicket() error = %v", err)
	}

	time.Sleep(20 * time.Millisecond)
	_, err = store.ValidateTicket(ticket)
	if !errors.Is(err, ErrExpiredWSTicket) {
		t.Fatalf("ValidateTicket() error = %v, want %v", err, ErrExpiredWSTicket)
	}
}

func TestValidateTicket_NonExistentTicket(t *testing.T) {
	t.Parallel()

	store := NewTicketStore(time.Minute)
	t.Cleanup(store.Close)

	_, err := store.ValidateTicket("does-not-exist")
	if !errors.Is(err, ErrInvalidWSTicket) {
		t.Fatalf("ValidateTicket() error = %v, want %v", err, ErrInvalidWSTicket)
	}
}

func TestValidateTicket_SingleUse(t *testing.T) {
	t.Parallel()

	store := NewTicketStore(time.Minute)
	t.Cleanup(store.Close)

	ticket, err := store.CreateTicket("single-use-user")
	if err != nil {
		t.Fatalf("CreateTicket() error = %v", err)
	}

	if _, err := store.ValidateTicket(ticket); err != nil {
		t.Fatalf("first ValidateTicket() error = %v", err)
	}

	_, err = store.ValidateTicket(ticket)
	if !errors.Is(err, ErrInvalidWSTicket) {
		t.Fatalf("second ValidateTicket() error = %v, want %v", err, ErrInvalidWSTicket)
	}
}

func TestCleanupExpiredLocked_DoesNotRemoveValidTicket(t *testing.T) {
	t.Parallel()

	store := NewTicketStore(time.Minute)
	t.Cleanup(store.Close)

	ticket, err := store.CreateTicket("survivor")
	if err != nil {
		t.Fatalf("CreateTicket() error = %v", err)
	}

	now := time.Now()
	store.mu.Lock()
	store.tickets["expired-ticket"] = wsTicket{
		userID:    "old-user",
		expiresAt: now.Add(-time.Second),
	}
	store.cleanupExpiredLocked(now)
	_, expiredStillPresent := store.tickets["expired-ticket"]
	_, validStillPresent := store.tickets[ticket]
	store.mu.Unlock()

	if expiredStillPresent {
		t.Fatalf("expired ticket should be removed")
	}
	if !validStillPresent {
		t.Fatalf("valid ticket should remain")
	}

	userID, err := store.ValidateTicket(ticket)
	if err != nil {
		t.Fatalf("ValidateTicket(valid) error = %v", err)
	}
	if userID != "survivor" {
		t.Fatalf("user id = %q, want %q", userID, "survivor")
	}
}
