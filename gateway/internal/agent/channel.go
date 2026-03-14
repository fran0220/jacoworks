package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	reconnectBaseDelay = 800 * time.Millisecond
	reconnectMaxDelay  = 15 * time.Second

	defaultIdleTTL      = 5 * time.Minute
	defaultRingBufSize  = 1024
	subscriberQueueSize = 256

	pongWait       = 120 * time.Second
	pingPeriod     = 30 * time.Second
	writeWait      = 10 * time.Second
	dialRetryTotal = 8 * time.Second
	dialRetryDelay = 300 * time.Millisecond
)

var (
	ErrChannelReconnecting = errors.New("channel reconnecting")
	ErrChannelNotConnected = errors.New("channel not connected")
)

type ChannelStatus struct {
	Connected     bool   `json:"connected"`
	Reconnecting  bool   `json:"reconnecting"`
	ContainerName string `json:"containerName"`
	Subscribers   int    `json:"subscribers"`
}

// channelKey identifies a unique channel by user and container type.
type channelKey struct {
	userID        string
	containerType string
}

// ChannelPool manages persistent upstream channels keyed by (userID, containerType).
type ChannelPool struct {
	dialers    map[string]UpstreamDialer
	store      *store.Store
	idleTTL    time.Duration
	bufferSize int

	mu       sync.RWMutex
	channels map[channelKey]*UserChannel
}

func NewChannelPool(s *store.Store, dialers map[string]UpstreamDialer, idleTTL time.Duration, bufferSize int) *ChannelPool {
	if idleTTL <= 0 {
		idleTTL = defaultIdleTTL
	}
	if bufferSize <= 0 {
		bufferSize = defaultRingBufSize
	}

	return &ChannelPool{
		dialers:    dialers,
		store:      s,
		idleTTL:    idleTTL,
		bufferSize: bufferSize,
		channels:   make(map[channelKey]*UserChannel),
	}
}

func (p *ChannelPool) GetOrCreate(ctx context.Context, userID, containerType string) (*UserChannel, *store.ContainerInfo, error) {
	if p.store == nil {
		return nil, nil, fmt.Errorf("channel pool not initialized")
	}

	dialer, ok := p.dialers[containerType]
	if !ok {
		return nil, nil, fmt.Errorf("unsupported container type: %s", containerType)
	}

	info, err := p.store.GetContainerInfo(ctx, userID, containerType)
	if err != nil {
		return nil, nil, err
	}

	key := channelKey{userID: userID, containerType: containerType}
	p.mu.Lock()
	ch := p.channels[key]
	if ch == nil || ch.closed.Load() {
		ch = newUserChannel(p, userID, containerType, dialer)
		p.channels[key] = ch
	}
	p.mu.Unlock()

	ch.setContainerName(info.ContainerName)
	return ch, info, nil
}

func (p *ChannelPool) Get(userID, containerType string) *UserChannel {
	key := channelKey{userID: userID, containerType: containerType}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.channels[key]
}

func (p *ChannelPool) ContainerInfo(ctx context.Context, userID, containerType string) (*store.ContainerInfo, error) {
	if p.store == nil {
		return nil, fmt.Errorf("channel pool not initialized")
	}
	return p.store.GetContainerInfo(ctx, userID, containerType)
}

func (p *ChannelPool) removeIfMatch(key channelKey, ch *UserChannel) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.channels[key] == ch {
		delete(p.channels, key)
	}
}

func (p *ChannelPool) Close() {
	p.mu.Lock()
	channels := make([]*UserChannel, 0, len(p.channels))
	for _, ch := range p.channels {
		channels = append(channels, ch)
	}
	p.channels = make(map[channelKey]*UserChannel)
	p.mu.Unlock()

	for _, ch := range channels {
		ch.Close()
	}
}

// UserChannel maintains one upstream WS session and fans out events to SSE/WS clients.
type UserChannel struct {
	pool          *ChannelPool
	userID        string
	containerType string
	dialer        UpstreamDialer

	eventBuffer *RingBuffer

	mu              sync.RWMutex
	upstream        *websocket.Conn
	containerName   string
	subscribers     map[uint64]chan Event
	nextSubscriber  uint64
	idleCloseTimer  *time.Timer
	upstreamWriteMu sync.Mutex

	reconnecting atomic.Bool
	closed       atomic.Bool

	stopCh chan struct{}
	doneCh chan struct{}
}

func newUserChannel(pool *ChannelPool, userID, containerType string, dialer UpstreamDialer) *UserChannel {
	ch := &UserChannel{
		pool:          pool,
		userID:        userID,
		containerType: containerType,
		dialer:        dialer,
		eventBuffer:   NewRingBuffer(pool.bufferSize),
		subscribers:   make(map[uint64]chan Event),
		stopCh:        make(chan struct{}),
		doneCh:        make(chan struct{}),
	}

	ch.reconnecting.Store(true)
	go ch.run()
	return ch
}

func (c *UserChannel) setContainerName(name string) {
	c.mu.Lock()
	c.containerName = name
	c.mu.Unlock()
}

func (c *UserChannel) Status() ChannelStatus {
	c.mu.RLock()
	connected := c.upstream != nil
	containerName := c.containerName
	subscribers := len(c.subscribers)
	c.mu.RUnlock()

	return ChannelStatus{
		Connected:     connected && !c.reconnecting.Load(),
		Reconnecting:  c.reconnecting.Load(),
		ContainerName: containerName,
		Subscribers:   subscribers,
	}
}

func (c *UserChannel) Subscribe(lastSeq uint64) ([]Event, <-chan Event, func()) {
	sub := make(chan Event, subscriberQueueSize)

	c.mu.Lock()
	c.nextSubscriber++
	id := c.nextSubscriber
	c.subscribers[id] = sub
	if c.idleCloseTimer != nil {
		c.idleCloseTimer.Stop()
		c.idleCloseTimer = nil
	}
	c.mu.Unlock()

	replay := c.eventBuffer.ReplayFrom(lastSeq)

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			c.mu.Lock()
			if existing, ok := c.subscribers[id]; ok {
				delete(c.subscribers, id)
				close(existing)
			}
			if len(c.subscribers) == 0 {
				c.scheduleIdleCloseLocked()
			}
			c.mu.Unlock()
		})
	}

	return replay, sub, unsubscribe
}

// SendRequest sends a protocol message to the upstream container.
// Uses the channel's dialer to format the message according to the upstream protocol.
func (c *UserChannel) SendRequest(msgType string, payload json.RawMessage, requestID string) error {
	if c.reconnecting.Load() {
		return ErrChannelReconnecting
	}

	c.mu.RLock()
	upstream := c.upstream
	containerName := c.containerName
	c.mu.RUnlock()

	if upstream == nil {
		return ErrChannelNotConnected
	}

	data, err := c.dialer.FormatClientMessage(msgType, payload, requestID)
	if err != nil {
		return fmt.Errorf("format request: %w", err)
	}

	c.upstreamWriteMu.Lock()
	_ = upstream.SetWriteDeadline(time.Now().Add(writeWait))
	err = upstream.WriteMessage(websocket.TextMessage, data)
	_ = upstream.SetWriteDeadline(time.Time{})
	c.upstreamWriteMu.Unlock()
	if err != nil {
		c.reconnecting.Store(true)
		_ = upstream.Close()
		c.publishProxyError("upstream unavailable, reconnecting")
		return ErrChannelReconnecting
	}

	if freezer := c.dialer.GetFreezer(); freezer != nil && containerName != "" {
		freezer.Touch(containerName)
	}

	return nil
}

func (c *UserChannel) Close() {
	if !c.closed.CompareAndSwap(false, true) {
		return
	}

	close(c.stopCh)

	c.mu.Lock()
	if c.idleCloseTimer != nil {
		c.idleCloseTimer.Stop()
		c.idleCloseTimer = nil
	}
	upstream := c.upstream
	c.upstream = nil
	subscribers := c.subscribers
	c.subscribers = make(map[uint64]chan Event)
	c.mu.Unlock()

	if upstream != nil {
		_ = upstream.Close()
	}

	for _, sub := range subscribers {
		close(sub)
	}

	<-c.doneCh
}

func (c *UserChannel) run() {
	defer close(c.doneCh)

	backoff := reconnectBaseDelay

	for {
		select {
		case <-c.stopCh:
			return
		default:
		}

		c.reconnecting.Store(true)

		info, err := c.pool.store.GetContainerInfo(context.Background(), c.userID, c.containerType)
		if err != nil {
			c.publishProxyError("container not provisioned")
			if !c.waitReconnect(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		c.setContainerName(info.ContainerName)

		if freezer := c.dialer.GetFreezer(); freezer != nil {
			freezer.Touch(info.ContainerName)
		}

		if err := c.dialer.EnsureRunning(context.Background(), info, c.userID); err != nil {
			log.Warn().Err(err).Str("user_id", c.userID).Str("container", info.ContainerName).Msg("agent channel: ensure running failed")
			c.publishProxyError("container unavailable, reconnecting")
			if !c.waitReconnect(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		upstream, err := c.dialer.Dial(info)
		if err != nil {
			log.Warn().Err(err).Str("user_id", c.userID).Str("url", c.dialer.UpstreamURL(info)).Msg("agent channel: upstream dial failed")
			c.publishProxyError("upstream connection failed, reconnecting")
			if !c.waitReconnect(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		c.mu.Lock()
		c.upstream = upstream
		c.containerName = info.ContainerName
		c.mu.Unlock()

		c.reconnecting.Store(false)
		backoff = reconnectBaseDelay
		c.publishProxyReady()

		// Set up pong-based liveness detection
		upstream.SetReadLimit(1 << 20)
		_ = upstream.SetReadDeadline(time.Now().Add(pongWait))
		upstream.SetPongHandler(func(string) error {
			return upstream.SetReadDeadline(time.Now().Add(pongWait))
		})

		pingDone := make(chan struct{})
		go func() {
			ticker := time.NewTicker(pingPeriod)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					c.upstreamWriteMu.Lock()
					err := upstream.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait))
					c.upstreamWriteMu.Unlock()
					if err != nil {
						return
					}
				case <-pingDone:
					return
				case <-c.stopCh:
					return
				}
			}
		}()

		if err := c.readLoop(upstream, info.ContainerName); err != nil {
			if !c.closed.Load() {
				log.Warn().Err(err).Str("user_id", c.userID).Str("container", info.ContainerName).Msg("agent channel: upstream disconnected")
				c.publishProxyError("upstream disconnected, reconnecting")
			}
		}
		close(pingDone)

		c.mu.Lock()
		if c.upstream == upstream {
			c.upstream = nil
		}
		c.mu.Unlock()
		_ = upstream.Close()
	}
}

func (c *UserChannel) readLoop(upstream *websocket.Conn, containerName string) error {
	for {
		msgType, msg, err := upstream.ReadMessage()
		if err != nil {
			return err
		}

		if freezer := c.dialer.GetFreezer(); freezer != nil {
			freezer.Touch(containerName)
		}

		if msgType != websocket.TextMessage {
			continue
		}

		eventType, data, ok := c.dialer.MapUpstreamMessage(msg)
		if !ok {
			continue
		}

		c.publish(eventType, data)
	}
}

func (c *UserChannel) publish(eventType string, data []byte) {
	if eventType == "" {
		return
	}

	event := c.eventBuffer.Push(Event{Event: eventType, Data: data})

	// Send while holding RLock to prevent concurrent close() from unsubscribe.
	// Sends are non-blocking so holding the lock briefly is safe.
	c.mu.RLock()
	for _, sub := range c.subscribers {
		select {
		case sub <- event:
		default:
			// Subscriber queue full — event dropped. Attempt to notify via proxy.gap.
			gapPayload, _ := json.Marshal(map[string]string{"type": "proxy.gap"})
			gapEvent := c.eventBuffer.Push(Event{Event: "proxy.gap", Data: gapPayload})
			select {
			case sub <- gapEvent:
			default:
			}
		}
	}
	c.mu.RUnlock()
}

func (c *UserChannel) publishProxyReady() {
	payload, _ := json.Marshal(map[string]string{"type": "proxy.ready"})
	c.publish("proxy.ready", payload)
}

func (c *UserChannel) publishProxyError(message string) {
	payload, _ := json.Marshal(map[string]string{"type": "proxy.error", "error": message})
	c.publish("proxy.error", payload)
}

func (c *UserChannel) scheduleIdleCloseLocked() {
	if c.idleCloseTimer != nil {
		c.idleCloseTimer.Stop()
	}

	key := channelKey{userID: c.userID, containerType: c.containerType}
	c.idleCloseTimer = time.AfterFunc(c.pool.idleTTL, func() {
		c.mu.RLock()
		idle := len(c.subscribers) == 0
		c.mu.RUnlock()

		if !idle || c.closed.Load() {
			return
		}

		c.Close()
		c.pool.removeIfMatch(key, c)
		log.Info().Str("user_id", c.userID).Str("container_type", c.containerType).Msg("agent channel: closed idle channel")
	})
}

func (c *UserChannel) waitReconnect(backoff time.Duration) bool {
	delay := backoff + jitter(backoff)
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-c.stopCh:
		return false
	case <-timer.C:
		return true
	}
}

func nextBackoff(current time.Duration) time.Duration {
	next := current * 2
	if next > reconnectMaxDelay {
		return reconnectMaxDelay
	}
	return next
}

func jitter(base time.Duration) time.Duration {
	if base <= 0 {
		return 0
	}
	window := base / 3
	if window <= 0 {
		return 0
	}
	return time.Duration(rand.Int64N(int64(window) + 1))
}

func dialWithRetry(url string, total time.Duration) (*websocket.Conn, error) {
	deadline := time.Now().Add(total)
	var lastErr error
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}

	for time.Now().Before(deadline) {
		conn, _, err := dialer.Dial(url, nil)
		if err == nil {
			return conn, nil
		}
		lastErr = err
		time.Sleep(dialRetryDelay)
	}
	return nil, fmt.Errorf("dial timeout after %s: %w", total, lastErr)
}
