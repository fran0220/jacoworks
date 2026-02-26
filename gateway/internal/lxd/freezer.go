package lxd

import (
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Freezer monitors container activity and freezes idle containers.
type Freezer struct {
	client      *SSHClient
	idleTimeout time.Duration
	interval    time.Duration
	prefix      string // container name prefix to manage (e.g. "oc-")

	mu             sync.Mutex
	lastSeen       map[string]time.Time // container name → last activity time
	onBeforeFreeze func(containerName string)
	onAfterFreeze  func(containerName string)
	stopCh         chan struct{}
}

func NewFreezer(client *SSHClient, idleTimeout, checkInterval time.Duration) *Freezer {
	return &Freezer{
		client:      client,
		idleTimeout: idleTimeout,
		interval:    checkInterval,
		prefix:      "oc-",
		lastSeen:    make(map[string]time.Time),
		stopCh:      make(chan struct{}),
	}
}

// Touch marks a container as active (call on every proxied request).
func (f *Freezer) Touch(containerName string) {
	if !strings.HasPrefix(containerName, f.prefix) {
		return
	}
	f.mu.Lock()
	f.lastSeen[containerName] = time.Now()
	f.mu.Unlock()
}

// Start begins the background freeze check loop.
func (f *Freezer) Start() {
	go func() {
		ticker := time.NewTicker(f.interval)
		defer ticker.Stop()

		log.Info().
			Dur("idle_timeout", f.idleTimeout).
			Dur("check_interval", f.interval).
			Msg("freezer started")

		for {
			select {
			case <-ticker.C:
				f.checkAndFreeze()
			case <-f.stopCh:
				return
			}
		}
	}()
}

func (f *Freezer) Stop() {
	close(f.stopCh)
}

// SetOnBeforeFreeze sets a callback that runs before a container is frozen.
// Used by main.go to pull memory files before freeze.
func (f *Freezer) SetOnBeforeFreeze(fn func(string)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.onBeforeFreeze = fn
}

// SetOnAfterFreeze sets a callback that runs after a container is frozen.
func (f *Freezer) SetOnAfterFreeze(fn func(string)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.onAfterFreeze = fn
}

func (f *Freezer) checkAndFreeze() {
	containers, err := f.client.List()
	if err != nil {
		log.Error().Err(err).Msg("freezer: list containers failed")
		return
	}

	now := time.Now()

	// Collect containers to freeze (under lock)
	f.mu.Lock()
	var toFreeze []string
	for _, ct := range containers {
		if !strings.HasPrefix(ct.Name, f.prefix) {
			continue
		}
		if strings.ToUpper(ct.Status) != "RUNNING" {
			continue
		}

		lastActivity, seen := f.lastSeen[ct.Name]
		if !seen {
			f.lastSeen[ct.Name] = now
			continue
		}

		if now.Sub(lastActivity) > f.idleTimeout {
			toFreeze = append(toFreeze, ct.Name)
		}
	}
	f.mu.Unlock()

	// Process freezes outside lock (callback may take time)
	for _, name := range toFreeze {
		log.Info().Str("container", name).Msg("freezing idle container")

		// Pre-freeze hook: pull memory
		if f.onBeforeFreeze != nil {
			f.onBeforeFreeze(name)
		}

		if err := f.client.Freeze(name); err != nil {
			log.Error().Err(err).Str("container", name).Msg("freeze failed")
		} else {
			if f.onAfterFreeze != nil {
				f.onAfterFreeze(name)
			}
			f.mu.Lock()
			delete(f.lastSeen, name)
			f.mu.Unlock()
		}
	}
}
