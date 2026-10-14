package relay

import (
	"encoding/json"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"

	"github.com/ilvesBogdan/naknigu/internal/pkg/httpx"
)

// Идентификатор сессии — 128 случайных бит (32 шестнадцатеричных знака),
// его создаёт книга. Кто знает идентификатор, тот читает сообщения сессии,
// поэтому он должен быть неугадываемым.
var sessionPattern = regexp.MustCompile(`^[a-z0-9]{32,64}$`)

// Channel — канал сессии.
type Channel string

const (
	// Book — сообщения для книги: статья, ход загрузки. Пишет телефон.
	Book Channel = "book"
	// Phone — сообщения для телефона: прогресс чтения, выход. Пишет книга.
	Phone Channel = "phone"
)

// Пределы размера сообщения. Статья с разметкой занимает десятки
// килобайт; сообщения книги (прогресс, просьба открыть ссылку) — меньше
// килобайта.
const (
	MaxBookMessageBytes  = 4 << 20
	MaxPhoneMessageBytes = 64 << 10
)

// Handler — HTTP-обёртка над Hub.
//
// Канал phone пишет книга, но только в сессию, с которой уже связался
// телефон (в её канале book есть сообщение): так книга без телефона
// ничего не кладёт в память сервера.
type Handler struct {
	hub *Hub
	log *slog.Logger
	// PollTimeout — сколько держать запрос открытым в ожидании сообщения.
	PollTimeout time.Duration
	// MaxWaitsPerClient — сколько ожиданий разом можно держать с одного адреса.
	MaxWaitsPerClient int
	// MaxGuestWaits — сколько ожиданий разом можно держать во всех сессиях,
	// с которыми ещё не связался телефон. Такую сессию заводит любая открытая
	// страница книги (её видят и посетители сайта проекта), и предел
	// не даёт им занять сервер. Связанные сессии этим пределом не ограничены.
	MaxGuestWaits int

	mu     sync.Mutex
	waits  map[string]int // ожидания по адресам клиентов
	guests int
}

// NewHandler создаёт обработчики поверх hub.
func NewHandler(hub *Hub, log *slog.Logger) *Handler {
	return &Handler{
		hub: hub, log: log, PollTimeout: 25 * time.Second,
		MaxWaitsPerClient: 16, MaxGuestWaits: 256, waits: map[string]int{},
	}
}

// sessionOf проверяет идентификатор сессии из адреса запроса. Неверный
// идентификатор — это адрес, которого нет: клиент получает 404.
func sessionOf(w http.ResponseWriter, r *http.Request) (string, bool) {
	session := r.PathValue("session")
	if !sessionPattern.MatchString(session) {
		httpx.NotFound(w, r)
		return "", false
	}
	return session, true
}

func key(session string, channel Channel) string {
	return session + "/" + string(channel)
}

type publishResponse struct {
	// Версия передаётся строкой: наносекунды не помещаются в число JavaScript.
	Version   string `json:"version"`
	Listeners int    `json:"listeners"`
}

type nextResponse struct {
	Version string          `json:"version"`
	Message json.RawMessage `json:"message"`
}

// Publish возвращает обработчик POST /api/sessions/{session}/<channel>.
func (h *Handler) Publish(channel Channel) http.HandlerFunc {
	limit := int64(MaxBookMessageBytes)
	if channel == Phone {
		limit = MaxPhoneMessageBytes
	}
	return func(w http.ResponseWriter, r *http.Request) {
		log := httpx.Logger(r.Context(), h.log)
		session, ok := sessionOf(w, r)
		if !ok {
			return
		}
		if channel == Phone && !h.hub.Has(key(session, Book)) {
			log.Warn("the book wrote to a session that no phone has opened, the message was not saved")
			httpx.WriteError(w, http.StatusForbidden, "not_paired")
			return
		}

		// Запрос с другим типом чужая страница может отправить без спроса
		// (простой запрос, без согласования CORS).
		if mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mediaType != "application/json" {
			log.Warn("the message is not sent as JSON, it was not saved", "channel", channel)
			httpx.WriteError(w, http.StatusUnsupportedMediaType, "not_json")
			return
		}

		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
		if err != nil {
			log.Warn("the message is too big, it was not saved", "channel", channel, "limit_bytes", limit)
			httpx.WriteError(w, http.StatusRequestEntityTooLarge, "too_large")
			return
		}
		var probe struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(body, &probe); err != nil {
			log.Warn("the message is not valid JSON, it was not saved", "channel", channel, "error", err.Error())
			httpx.WriteError(w, http.StatusBadRequest, "bad_json")
			return
		}

		version, listeners := h.hub.Publish(key(session, channel), body)
		log.Info("a message was saved",
			"channel", channel, "type", probe.Type, "bytes", len(body), "listeners", listeners)
		if listeners == 0 {
			log.Debug("nobody is waiting for this message now, it stays in memory", "channel", channel)
		}
		httpx.WriteJSON(w, http.StatusOK, publishResponse{Version: strconv.FormatInt(version, 10), Listeners: listeners})
	}
}

// Next возвращает обработчик GET /api/sessions/{session}/<channel>/next:
// сообщение новее версии after либо ожидание его (long polling).
// С параметром wait=0 не ждёт вовсе: так проверяют, нет ли уже сообщения.
func (h *Handler) Next(channel Channel) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log := httpx.Logger(r.Context(), h.log)
		session, ok := sessionOf(w, r)
		if !ok {
			return
		}
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		timeout := h.PollTimeout
		if r.URL.Query().Get("wait") == "0" {
			timeout = 0
		}

		if timeout > 0 {
			client := httpx.ClientIP(r)
			guest := !h.hub.Has(key(session, Book))
			if !h.enter(client, guest) {
				log.Warn("too many clients are waiting, the request was refused", "channel", channel, "guest", guest)
				w.Header().Set("Retry-After", "5")
				httpx.WriteError(w, http.StatusTooManyRequests, "too_many_requests")
				return
			}
			defer h.leave(client, guest)
		}

		log.Debug("a client is waiting for a message",
			"channel", channel, "after_version", after, "max_wait_ms", timeout.Milliseconds())
		msg, found := h.hub.Wait(r.Context(), key(session, channel), after, timeout)
		if !found {
			if r.Context().Err() != nil {
				log.Debug("the client stopped waiting", "channel", channel)
				return
			}
			log.Debug("no new message, the client can ask again", "channel", channel)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		log.Debug("a message was sent to the client", "channel", channel, "bytes", len(msg.Body))
		httpx.WriteJSON(w, http.StatusOK, nextResponse{Version: strconv.FormatInt(msg.Version, 10), Message: msg.Body})
	}
}

// enter учитывает ещё одно ожидание; false — предел уже достигнут.
func (h *Handler) enter(client string, guest bool) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.waits[client] >= h.MaxWaitsPerClient || guest && h.guests >= h.MaxGuestWaits {
		return false
	}
	h.waits[client]++
	if guest {
		h.guests++
	}
	return true
}

func (h *Handler) leave(client string, guest bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.waits[client]--; h.waits[client] <= 0 {
		delete(h.waits, client)
	}
	if guest {
		h.guests--
	}
}
