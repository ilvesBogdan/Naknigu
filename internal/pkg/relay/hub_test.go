package relay

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestPublishThenWait(t *testing.T) {
	hub := NewHub()
	version, listeners := hub.Publish("s/book", json.RawMessage(`{"n":1}`))
	if listeners != 0 {
		t.Errorf("listeners = %d, ожидался 0", listeners)
	}

	msg, ok := hub.Wait(context.Background(), "s/book", 0, 0)
	if !ok || msg.Version != version || string(msg.Body) != `{"n":1}` {
		t.Errorf("получено %+v, %v", msg, ok)
	}
	// То же сообщение повторно не отдаётся.
	if _, ok := hub.Wait(context.Background(), "s/book", version, 10*time.Millisecond); ok {
		t.Error("сообщение отдано второй раз")
	}
	// Соседний канал той же сессии пуст.
	if _, ok := hub.Wait(context.Background(), "s/phone", 0, 0); ok {
		t.Error("сообщение попало в чужой канал")
	}
}

func TestWaitIsWokenByPublish(t *testing.T) {
	hub := NewHub()
	got := make(chan Message, 1)
	go func() {
		msg, _ := hub.Wait(context.Background(), "s/book", 0, 5*time.Second)
		got <- msg
	}()

	// Публикуем, пока ожидающий не встанет в очередь.
	deadline := time.After(3 * time.Second)
	for {
		if _, listeners := hub.Publish("s/book", json.RawMessage(`"hi"`)); listeners == 1 {
			break
		}
		select {
		case <-got:
			return // ожидающий успел забрать предыдущую публикацию — тоже верно
		case <-deadline:
			t.Fatal("ожидающий так и не появился")
		case <-time.After(2 * time.Millisecond):
		}
	}
	select {
	case msg := <-got:
		if string(msg.Body) != `"hi"` {
			t.Errorf("получено %s", msg.Body)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("ожидающий не разбужен")
	}
}

func TestWaitStopsWhenClientLeaves(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	if _, ok := hub.Wait(ctx, "s/book", 0, 5*time.Second); ok || time.Since(start) > time.Second {
		t.Error("ожидание не прервалось вместе с запросом")
	}
}

func TestVersionsAlwaysGrow(t *testing.T) {
	hub := NewHub()
	hub.now = func() time.Time { return time.Unix(100, 0) } // часы стоят на месте
	first, _ := hub.Publish("s/book", json.RawMessage(`1`))
	second, _ := hub.Publish("s/book", json.RawMessage(`2`))
	if second <= first {
		t.Errorf("версии не растут: %d, затем %d", first, second)
	}
}

func TestEviction(t *testing.T) {
	now := time.Unix(1000, 0)
	hub := NewHub()
	hub.maxChannels, hub.ttl = 2, time.Hour
	hub.now = func() time.Time { return now }

	hub.Publish("a/book", json.RawMessage(`1`))
	now = now.Add(time.Minute)
	hub.Publish("b/book", json.RawMessage(`1`))
	now = now.Add(time.Minute)
	hub.Publish("c/book", json.RawMessage(`1`)) // места нет: уходит самый давний, "a"
	if _, ok := hub.Wait(context.Background(), "b/book", 0, 0); !ok || len(hub.channels) != 2 {
		t.Errorf("после переполнения каналов %d, канал b на месте: %v", len(hub.channels), ok)
	}

	now = now.Add(2 * time.Hour)
	hub.Publish("d/book", json.RawMessage(`1`)) // всё прежнее протухло
	if len(hub.channels) != 1 {
		t.Errorf("после истечения срока каналов %d, ожидался 1", len(hub.channels))
	}
}

func TestWaitingDoesNotTakeMemory(t *testing.T) {
	hub := NewHub()
	hub.maxChannels = 1
	hub.Publish("owner/book", json.RawMessage(`1`))

	// Кто угодно может ждать в любой сессии, но место в памяти занимают
	// только каналы с сообщением: ожидание не вытесняет статью владельца.
	for _, key := range []string{"a/book", "b/book", "c/book"} {
		hub.Wait(context.Background(), key, 0, 0)
	}
	if !hub.Has("owner/book") {
		t.Error("ожидания вытеснили сообщение")
	}
	if len(hub.channels) != 1 {
		t.Errorf("после ожиданий осталось каналов: %d", len(hub.channels))
	}
	if hub.Has("a/book") {
		t.Error("в пустом канале появилось сообщение")
	}
}
