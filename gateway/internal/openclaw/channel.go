package openclaw

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

// ChannelPool manages one persistent upstream channel per user.
type ChannelPool struct {
	proxy      *WSProxy
	idleTTL    time.Duration
	bufferSize int

	mu       sync.RWMutex
	channels map[string]*UserChannel
}

func NewChannelPool(proxy *WSProxy, idleTTL time.Duration, bufferSize int) *ChannelPool {
	if idleTTL <= 0 {
		idleTTL = defaultIdleTTL
	}
	if bufferSize <= 0 {
		bufferSize = defaultRingBufSize
	}

	return &ChannelPool{
		proxy:      proxy,
		idleTTL:    idleTTL,
		bufferSize: bufferSize,
		channels:   make(map[string]*UserChannel),
	}
}

func (p *ChannelPool) GetOrCreate(ctx context.Context, userID string) (*UserChannel, *store.ContainerInfo, error) {
	if p.proxy == nil || p.proxy.store == nil {
		return nil, nil, fmt.Errorf("channel pool not initialized")
	}

	info, err := p.proxy.store.GetContainerInfo(ctx, userID)
	if err != nil {
		return nil, nil, err
	}

	p.mu.Lock()
	ch := p.channels[userID]
	if ch == nil || ch.closed.Load() {
		ch = newUserChannel(p, userID)
		p.channels[userID] = ch
	}
	p.mu.Unlock()

	ch.setContainerName(info.ContainerName)
	return ch, info, nil
}

func (p *ChannelPool) Get(userID string) *UserChannel {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.channels[userID]
}

func (p *ChannelPool) ContainerInfo(ctx context.Context, userID string) (*store.ContainerInfo, error) {
	if p.proxy == nil || p.proxy.store == nil {
		return nil, fmt.Errorf("channel pool not initialized")
	}
	return p.proxy.store.GetContainerInfo(ctx, userID)
}

func (p *ChannelPool) removeIfMatch(userID string, ch *UserChannel) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.channels[userID] == ch {
		delete(p.channels, userID)
	}
}

func (p *ChannelPool) Close() {
	p.mu.Lock()
	channels := make([]*UserChannel, 0, len(p.channels))
	for _, ch := range p.channels {
		channels = append(channels, ch)
	}
	p.channels = make(map[string]*UserChannel)
	p.mu.Unlock()

	for _, ch := range channels {
		ch.Close()
	}
}

// UserChannel maintains one upstream WS session and fans out events to SSE clients.
type UserChannel struct {
	pool   *ChannelPool
	userID string

	eventBuffer *RingBuffer

	mu              sync.RWMutex
	upstream        *websocket.Conn
	containerName   string
	subscribers     map[uint64]chan SSEEvent
	nextSubscriber  uint64
	idleCloseTimer  *time.Timer
	upstreamWriteMu sync.Mutex

	reconnecting atomic.Bool
	closed       atomic.Bool

	stopCh chan struct{}
	doneCh chan struct{}
}

func newUserChannel(pool *ChannelPool, userID string) *UserChannel {
	ch := &UserChannel{
		pool:        pool,
		userID:      userID,
		eventBuffer: NewRingBuffer(pool.bufferSize),
		subscribers: make(map[uint64]chan SSEEvent),
		stopCh:      make(chan struct{}),
		doneCh:      make(chan struct{}),
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

func (c *UserChannel) Subscribe(lastSeq uint64) ([]SSEEvent, <-chan SSEEvent, func()) {
	sub := make(chan SSEEvent, subscriberQueueSize)

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

func (c *UserChannel) SendRequest(method string, params json.RawMessage, requestID string) error {
	if method == "" {
		return fmt.Errorf("method is required")
	}
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}

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

	frame := struct {
		Type   string          `json:"type"`
		ID     string          `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}{
		Type:   "req",
		ID:     requestID,
		Method: method,
		Params: params,
	}

	payload, err := json.Marshal(frame)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}

	c.upstreamWriteMu.Lock()
	_ = upstream.SetWriteDeadline(time.Now().Add(writeWait))
	err = upstream.WriteMessage(websocket.TextMessage, payload)
	_ = upstream.SetWriteDeadline(time.Time{})
	c.upstreamWriteMu.Unlock()
	if err != nil {
		c.reconnecting.Store(true)
		_ = upstream.Close()
		c.publishProxyError("upstream unavailable, reconnecting")
		return ErrChannelReconnecting
	}

	if c.pool.proxy.freezer != nil && containerName != "" {
		c.pool.proxy.freezer.Touch(containerName)
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
	c.subscribers = make(map[uint64]chan SSEEvent)
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

		info, err := c.pool.proxy.store.GetContainerInfo(context.Background(), c.userID)
		if err != nil {
			c.publishProxyError("container not provisioned")
			if !c.waitReconnect(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		c.setContainerName(info.ContainerName)

		if c.pool.proxy.freezer != nil {
			c.pool.proxy.freezer.Touch(info.ContainerName)
		}

		if err := c.pool.proxy.ensureRunning(context.Background(), info, c.userID); err != nil {
			log.Warn().Err(err).Str("user_id", c.userID).Str("container", info.ContainerName).Msg("openclaw channel: ensure running failed")
			c.publishProxyError("container unavailable, reconnecting")
			if !c.waitReconnect(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		upstreamURL := fmt.Sprintf("ws://%s:%d", info.ContainerIP, c.pool.proxy.openclawPort)
		upstream, err := dialWithRetry(upstreamURL, dialRetryTotal)
		if err != nil {
			log.Warn().Err(err).Str("user_id", c.userID).Str("url", upstreamURL).Msg("openclaw channel: upstream dial failed")
			c.publishProxyError("upstream connection failed, reconnecting")
			if !c.waitReconnect(backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		if err := c.pool.proxy.performHandshake(upstream, info.ContainerToken); err != nil {
			_ = upstream.Close()
			log.Warn().Err(err).Str("user_id", c.userID).Str("container", info.ContainerName).Msg("openclaw channel: handshake failed")
			c.publishProxyError("authentication failed, reconnecting")
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
				log.Warn().Err(err).Str("user_id", c.userID).Str("container", info.ContainerName).Msg("openclaw channel: upstream disconnected")
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

		if c.pool.proxy.freezer != nil {
			c.pool.proxy.freezer.Touch(containerName)
		}

		if msgType != websocket.TextMessage {
			continue
		}

		eventType, ok := mapUpstreamToEvent(msg)
		if !ok {
			continue
		}

		c.publish(eventType, msg)
	}
}

func (c *UserChannel) publish(eventType string, data []byte) {
	if eventType == "" {
		return
	}

	event := c.eventBuffer.Push(SSEEvent{Event: eventType, Data: data})

	c.mu.RLock()
	subscribers := make([]chan SSEEvent, 0, len(c.subscribers))
	for _, sub := range c.subscribers {
		subscribers = append(subscribers, sub)
	}
	c.mu.RUnlock()

	for _, sub := range subscribers {
		select {
		case sub <- event:
		default:
		}
	}
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

	c.idleCloseTimer = time.AfterFunc(c.pool.idleTTL, func() {
		c.mu.RLock()
		idle := len(c.subscribers) == 0
		c.mu.RUnlock()

		if !idle || c.closed.Load() {
			return
		}

		c.Close()
		c.pool.removeIfMatch(c.userID, c)
		log.Info().Str("user_id", c.userID).Msg("openclaw channel: closed idle channel")
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

func mapUpstreamToEvent(msg []byte) (string, bool) {
	var envelope struct {
		Type  string `json:"type"`
		Event string `json:"event"`
	}
	if err := json.Unmarshal(msg, &envelope); err != nil {
		return "", false
	}

	switch envelope.Type {
	case "event":
		if envelope.Event == "" {
			return "event", true
		}
		return envelope.Event, true
	case "res":
		return "response", true
	case "proxy.ready", "proxy.error":
		return envelope.Type, true
	default:
		return "", false
	}
}
