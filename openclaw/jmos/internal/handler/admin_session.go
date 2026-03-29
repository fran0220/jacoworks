package handler

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"sync"
)

type AdminSessionStore struct {
	mu     sync.RWMutex
	tokens map[string]struct{}
}

func NewAdminSessionStore() *AdminSessionStore {
	return &AdminSessionStore{
		tokens: make(map[string]struct{}),
	}
}

func (s *AdminSessionStore) Create() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)

	s.mu.Lock()
	s.tokens[token] = struct{}{}
	s.mu.Unlock()

	return token, nil
}

func (s *AdminSessionStore) Valid(token string) bool {
	if token == "" {
		return false
	}

	s.mu.RLock()
	_, ok := s.tokens[token]
	s.mu.RUnlock()
	return ok
}

func adminPasswordMatches(expected, actual string) bool {
	if expected == "" || actual == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}
