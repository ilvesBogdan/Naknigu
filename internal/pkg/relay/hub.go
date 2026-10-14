package relay

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// Message — сообщение канала вместе с его версией.
type Message struct {
	// Version — время публикации в наносекундах. Растёт и после перезапуска
	// сервера, поэтому клиент может хранить последнюю виденную версию у себя.
	Version int64
	Body    json.RawMessage
}

type channel struct {
	message   Message
	changed   chan struct{} // закрывается при публикации
	listeners int
	touched   time.Time
}

// Hub хранит каналы в памяти.
//
// Память занимают только каналы с сообщением, и их не больше maxChannels.
// Канал без сообщения живёт, пока его кто-то ждёт, и исчезает вместе
// с последним ожидающим: так одно ожидание (а его может начать кто угодно)
// не вытеснит чужие сообщения.
type Hub struct {
	maxChannels int              // сколько каналов с сообщением помнить одновременно
	ttl         time.Duration    // через сколько простоя канал забывается
	now         func() time.Time // часы; в тестах подменяются

	mu       sync.Mutex
	channels map[string]*channel
}

// NewHub создаёт пустой Hub.
func NewHub() *Hub {
	return &Hub{maxChannels: 512, ttl: 24 * time.Hour, now: time.Now, channels: make(map[string]*channel)}
}

// Has сообщает, есть ли в канале сообщение.
func (h *Hub) Has(key string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch, ok := h.channels[key]
	return ok && ch.message.Version > 0
}

// evict удаляет протухшие каналы с сообщением, а если их всё равно
// maxChannels или больше — самый давний из тех, которые никто не слушает.
// Вызывать под h.mu.
func (h *Hub) evict(now time.Time) {
	var oldestKey string
	var oldest time.Time
	stored := 0
	for key, ch := range h.channels {
		if ch.message.Version == 0 {
			continue // ожидание без сообщения; уйдёт вместе с ожидающими
		}
		if ch.listeners == 0 && now.Sub(ch.touched) > h.ttl {
			delete(h.channels, key)
			continue
		}
		stored++
		if ch.listeners == 0 && (oldestKey == "" || ch.touched.Before(oldest)) {
			oldestKey, oldest = key, ch.touched
		}
	}
	if stored >= h.maxChannels && oldestKey != "" {
		delete(h.channels, oldestKey)
	}
}

// Publish кладёт сообщение в канал и будит ожидающих. Возвращает версию
// сообщения и число клиентов, которые ждали его в этот момент.
func (h *Hub) Publish(key string, body json.RawMessage) (version int64, listeners int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	ch, ok := h.channels[key]
	if !ok || ch.message.Version == 0 {
		// Появится ещё один канал с сообщением — освобождаем место.
		h.evict(now)
	}
	if !ok {
		ch = &channel{changed: make(chan struct{})}
		h.channels[key] = ch
	}
	ch.touched = now
	// Версия обязана расти, даже если часы дали то же значение.
	version = max(now.UnixNano(), ch.message.Version+1)
	ch.message = Message{Version: version, Body: body}
	close(ch.changed)
	ch.changed = make(chan struct{})
	return version, ch.listeners
}

// Wait возвращает сообщение канала новее версии after. Если такого нет,
// ждёт его не дольше timeout; false означает, что сообщение не появилось.
func (h *Hub) Wait(ctx context.Context, key string, after int64, timeout time.Duration) (Message, bool) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	h.mu.Lock()
	ch, ok := h.channels[key]
	if !ok {
		ch = &channel{changed: make(chan struct{})}
		h.channels[key] = ch
	}
	ch.touched = h.now()
	ch.listeners++
	defer func() {
		h.mu.Lock()
		ch.listeners--
		if ch.listeners == 0 && ch.message.Version == 0 && h.channels[key] == ch {
			delete(h.channels, key)
		}
		h.mu.Unlock()
	}()

	for {
		if ch.message.Version > after {
			msg := ch.message
			h.mu.Unlock()
			return msg, true
		}
		changed := ch.changed
		h.mu.Unlock()

		select {
		case <-changed:
		case <-timer.C:
			return Message{}, false
		case <-ctx.Done():
			return Message{}, false
		}
		h.mu.Lock()
	}
}
