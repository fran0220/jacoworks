package openclaw

import "sync"

// SSEEvent is an event frame delivered to SSE subscribers.
type SSEEvent struct {
	Seq   uint64
	Event string
	Data  []byte
}

// RingBuffer stores recent events for Last-Event-ID based replay.
type RingBuffer struct {
	mu      sync.RWMutex
	buf     []SSEEvent
	start   int
	count   int
	nextSeq uint64
}

func NewRingBuffer(size int) *RingBuffer {
	if size <= 0 {
		size = 1024
	}
	return &RingBuffer{
		buf:     make([]SSEEvent, size),
		nextSeq: 1,
	}
}

// Push appends an event and assigns a monotonically increasing sequence.
func (r *RingBuffer) Push(event SSEEvent) SSEEvent {
	r.mu.Lock()
	defer r.mu.Unlock()

	event.Seq = r.nextSeq
	r.nextSeq++
	event = cloneSSEEvent(event)

	idx := 0
	if r.count < len(r.buf) {
		idx = (r.start + r.count) % len(r.buf)
		r.count++
	} else {
		idx = r.start
		r.start = (r.start + 1) % len(r.buf)
	}

	r.buf[idx] = event
	return cloneSSEEvent(event)
}

// ReplayFrom returns all events newer than lastSeq.
func (r *RingBuffer) ReplayFrom(lastSeq uint64) []SSEEvent {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if r.count == 0 || lastSeq == 0 {
		return nil
	}

	out := make([]SSEEvent, 0, r.count)
	for i := 0; i < r.count; i++ {
		idx := (r.start + i) % len(r.buf)
		ev := r.buf[idx]
		if ev.Seq > lastSeq {
			out = append(out, cloneSSEEvent(ev))
		}
	}
	return out
}

func cloneSSEEvent(event SSEEvent) SSEEvent {
	out := SSEEvent{Seq: event.Seq, Event: event.Event}
	if len(event.Data) > 0 {
		out.Data = append([]byte(nil), event.Data...)
	}
	return out
}
