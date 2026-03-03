package lxd

import (
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Freezer monitors container activity and stops idle containers.
// Containers stay running until idle for idleTimeout, then get stopped
// to free memory. On next connection, ensureRunning will restart them.
type Freezer struct {
	client      *SSHClient
	idleTimeout time.Duration
	interval    time.Duration
	prefix      string // container name prefix to manage (e.g. "oc-")

	mu            sync.Mutex
	lastSeen      map[string]time.Time // container name → last activity time
	onBeforeStop  func(containerName string)
	onAfterStop   func(containerName string)
	stopCh        chan struct{}
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

// Start begins the background idle check loop.
func (f *Freezer) Start() {
	go func() {
		ticker := time.NewTicker(f.interval)
		defer ticker.Stop()

		log.Info().
			Dur("idle_timeout", f.idleTimeout).
			Dur("check_interval", f.interval).
			Msg("idle monitor started")

		for {
			select {
			case <-ticker.C:
				f.checkAndStop()
			case <-f.stopCh:
				return
			}
		}
	}()
}

func (f *Freezer) Stop() {
	close(f.stopCh)
}

// SetOnBeforeFreeze sets a callback that runs before a container is stopped.
// Used by main.go to pull memory files before stop.
func (f *Freezer) SetOnBeforeFreeze(fn func(string)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.onBeforeStop = fn
}

// SetOnAfterFreeze sets a callback that runs after a container is stopped.
func (f *Freezer) SetOnAfterFreeze(fn func(string)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.onAfterStop = fn
}

func (f *Freezer) checkAndStop() {
	containers, err := f.client.List()
	if err != nil {
		log.Error().Err(err).Msg("idle monitor: list containers failed")
		return
	}

	now := time.Now()

	f.mu.Lock()
	var toStop []string
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
			toStop = append(toStop, ct.Name)
		}
	}
	f.mu.Unlock()

	for _, name := range toStop {
		log.Info().Str("container", name).Dur("idle", f.idleTimeout).Msg("stopping idle container")

		if f.onBeforeStop != nil {
			f.onBeforeStop(name)
		}

		if err := f.client.Stop(name); err != nil {
			log.Error().Err(err).Str("container", name).Msg("stop idle container failed")
		} else {
			if f.onAfterStop != nil {
				f.onAfterStop(name)
			}
			f.mu.Lock()
			delete(f.lastSeen, name)
			f.mu.Unlock()
		}
	}
}
