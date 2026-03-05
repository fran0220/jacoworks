package agent

import "sync"

// RingBuffer stores recent events for Last-Event-ID based replay.
type RingBuffer struct {
	mu      sync.RWMutex
	buf     []Event
	start   int
	count   int
	nextSeq uint64
}

func NewRingBuffer(size int) *RingBuffer {
	if size <= 0 {
		size = 1024
	}
	return &RingBuffer{
		buf:     make([]Event, size),
		nextSeq: 1,
	}
}

// Push appends an event and assigns a monotonically increasing sequence.
func (r *RingBuffer) Push(event Event) Event {
	r.mu.Lock()
	defer r.mu.Unlock()

	event.Seq = r.nextSeq
	r.nextSeq++
	event = cloneEvent(event)

	idx := 0
	if r.count < len(r.buf) {
		idx = (r.start + r.count) % len(r.buf)
		r.count++
	} else {
		idx = r.start
		r.start = (r.start + 1) % len(r.buf)
	}

	r.buf[idx] = event
	return cloneEvent(event)
}

// ReplayFrom returns all events newer than lastSeq.
func (r *RingBuffer) ReplayFrom(lastSeq uint64) []Event {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if r.count == 0 || lastSeq == 0 {
		return nil
	}

	out := make([]Event, 0, r.count)
	for i := 0; i < r.count; i++ {
		idx := (r.start + i) % len(r.buf)
		ev := r.buf[idx]
		if ev.Seq > lastSeq {
			out = append(out, cloneEvent(ev))
		}
	}
	return out
}

func cloneEvent(event Event) Event {
	out := Event{Seq: event.Seq, Event: event.Event}
	if len(event.Data) > 0 {
		out.Data = append([]byte(nil), event.Data...)
	}
	return out
}
