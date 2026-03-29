package container

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// containerState tracks a container's idle state for the two-tier strategy.
type containerState struct {
	lastSeen time.Time
	paused   bool // true if already paused (awaiting stop threshold)
	pausedAt time.Time
}

// Freezer monitors container activity and applies a two-tier idle strategy:
//   - After pauseTimeout of inactivity: freeze (lightweight, instant resume)
//   - After stopTimeout of being frozen: stop (frees resources fully)
type Freezer struct {
	rt           Runtime
	pauseTimeout time.Duration // idle → freeze
	stopTimeout  time.Duration // frozen → stop
	interval     time.Duration
	prefix       string // container name prefix to manage (e.g. "agent-")

	mu           sync.Mutex
	containers   map[string]*containerState
	onBeforeStop func(containerName string)
	onAfterStop  func(containerName string)
	stopCh       chan struct{}
}

func NewFreezer(rt Runtime, pauseTimeout, stopTimeout, checkInterval time.Duration) *Freezer {
	return NewFreezerWithPrefix(rt, "agent-", pauseTimeout, stopTimeout, checkInterval)
}

// NewFreezerWithPrefix creates a Freezer with a custom container name prefix.
func NewFreezerWithPrefix(rt Runtime, prefix string, pauseTimeout, stopTimeout, checkInterval time.Duration) *Freezer {
	return &Freezer{
		rt:           rt,
		pauseTimeout: pauseTimeout,
		stopTimeout:  stopTimeout,
		interval:     checkInterval,
		prefix:       prefix,
		containers:   make(map[string]*containerState),
		stopCh:       make(chan struct{}),
	}
}

// Touch marks a container as active (call on every proxied request).
// If the container was frozen, this does NOT unfreeze it — the caller
// should call Runtime.Unfreeze() separately.
func (f *Freezer) Touch(containerName string) {
	if !strings.HasPrefix(containerName, f.prefix) {
		return
	}
	f.mu.Lock()
	if cs, ok := f.containers[containerName]; ok {
		cs.lastSeen = time.Now()
		cs.paused = false
	} else {
		f.containers[containerName] = &containerState{lastSeen: time.Now()}
	}
	f.mu.Unlock()
}

// Start begins the background idle check loop.
func (f *Freezer) Start() {
	go func() {
		ticker := time.NewTicker(f.interval)
		defer ticker.Stop()

		log.Info().
			Dur("pause_timeout", f.pauseTimeout).
			Dur("stop_timeout", f.stopTimeout).
			Dur("check_interval", f.interval).
			Msg("idle monitor started")

		for {
			select {
			case <-ticker.C:
				f.checkIdle()
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

func (f *Freezer) checkIdle() {
	ctx := context.Background()

	containers, err := f.rt.List(ctx)
	if err != nil {
		log.Error().Err(err).Msg("idle monitor: list containers failed")
		return
	}

	now := time.Now()

	f.mu.Lock()

	var toFreeze []string
	var toStop []string

	for _, ct := range containers {
		if !strings.HasPrefix(ct.Name, f.prefix) {
			continue
		}

		cs, tracked := f.containers[ct.Name]
		if !tracked {
			f.containers[ct.Name] = &containerState{lastSeen: now}
			continue
		}

		switch ct.Status {
		case "running":
			if now.Sub(cs.lastSeen) > f.pauseTimeout {
				toFreeze = append(toFreeze, ct.Name)
			}
		case "paused":
			if f.stopTimeout > 0 && cs.paused && now.Sub(cs.pausedAt) > f.stopTimeout {
				toStop = append(toStop, ct.Name)
			}
		}
	}
	f.mu.Unlock()

	// Tier 1: freeze idle running containers
	for _, name := range toFreeze {
		log.Info().Str("container", name).Dur("idle", f.pauseTimeout).Msg("freezing idle container")
		if err := f.rt.Freeze(ctx, name); err != nil {
			log.Error().Err(err).Str("container", name).Msg("freeze idle container failed")
		} else {
			f.mu.Lock()
			if cs, ok := f.containers[name]; ok {
				cs.paused = true
				cs.pausedAt = now
			}
			f.mu.Unlock()
		}
	}

	// Tier 2: stop containers that have been frozen too long
	for _, name := range toStop {
		log.Info().Str("container", name).Dur("paused_for", f.stopTimeout).Msg("stopping long-frozen container")

		if f.onBeforeStop != nil {
			f.onBeforeStop(name)
		}

		// Unfreeze first (stop requires running state)
		if err := f.rt.Unfreeze(ctx, name); err != nil {
			log.Warn().Err(err).Str("container", name).Msg("unfreeze before stop failed")
		}

		if err := f.rt.Stop(ctx, name); err != nil {
			log.Error().Err(err).Str("container", name).Msg("stop frozen container failed")
		} else {
			if f.onAfterStop != nil {
				f.onAfterStop(name)
			}
			f.mu.Lock()
			delete(f.containers, name)
			f.mu.Unlock()
		}
	}
}
