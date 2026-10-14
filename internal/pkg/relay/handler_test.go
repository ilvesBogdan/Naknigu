package relay

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ilvesBogdan/naknigu/internal/pkg/httpx"
)

const (
	testSession  = "abcdefgh12345678abcdefgh12345678"
	otherSession = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
)

// newRouter собирает маршруты так же, как сервер.
func newRouter(h *Handler) http.Handler {
	h.PollTimeout = 30 * time.Millisecond
	return httpx.Router([]httpx.Route{
		{Method: http.MethodPost, Path: "/api/sessions/{session}/book", Handler: h.Publish(Book)},
		{Method: http.MethodPost, Path: "/api/sessions/{session}/phone", Handler: h.Publish(Phone)},
		{Method: http.MethodGet, Path: "/api/sessions/{session}/book/next", Handler: h.Next(Book)},
		{Method: http.MethodGet, Path: "/api/sessions/{session}/phone/next", Handler: h.Next(Phone)},
	})
}

func newHandler() *Handler {
	return NewHandler(NewHub(), slog.New(slog.NewJSONHandler(io.Discard, nil)))
}

func do(r http.Handler, method, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/json")
	}
	r.ServeHTTP(rec, req)
	return rec
}

func TestRoutes(t *testing.T) {
	r := newRouter(newHandler())
	do(r, http.MethodPost, "/api/sessions/"+testSession+"/book", `{"type":"article"}`)

	tests := []struct {
		name, method, path, body string
		wantStatus               int
		wantBody                 string
	}{
		{"прогресс от книги принят", http.MethodPost, "/api/sessions/" + testSession + "/phone", `{"type":"progress"}`, http.StatusOK, `"listeners":0`},
		{"сообщение получено", http.MethodGet, "/api/sessions/" + testSession + "/book/next?after=0", "", http.StatusOK, `"message":{"type":"article"}`},
		{"нового нет — 204", http.MethodGet, "/api/sessions/" + testSession + "/book/next?after=9223372036854775807", "", http.StatusNoContent, ""},
		{"без ожидания", http.MethodGet, "/api/sessions/" + otherSession + "/book/next?wait=0", "", http.StatusNoContent, ""},
		{"книга пишет в несвязанную сессию", http.MethodPost, "/api/sessions/" + otherSession + "/phone", `{"type":"progress"}`, http.StatusForbidden, "not_paired"},
		{"не JSON", http.MethodPost, "/api/sessions/" + testSession + "/book", `привет`, http.StatusBadRequest, "bad_json"},
		{"слишком большая статья", http.MethodPost, "/api/sessions/" + testSession + "/book", `"` + strings.Repeat("a", MaxBookMessageBytes) + `"`, http.StatusRequestEntityTooLarge, "too_large"},
		{"слишком большое сообщение книги", http.MethodPost, "/api/sessions/" + testSession + "/phone", `"` + strings.Repeat("a", MaxPhoneMessageBytes) + `"`, http.StatusRequestEntityTooLarge, "too_large"},
		{"короткий идентификатор", http.MethodPost, "/api/sessions/abcdefgh12345678/book", `{}`, http.StatusNotFound, "not_found"},
		{"недопустимые символы", http.MethodPost, "/api/sessions/ABCDEFGH_2345678abcdefgh12345678/book", `{}`, http.StatusNotFound, "not_found"},
		{"неизвестный канал", http.MethodGet, "/api/sessions/" + testSession + "/tv/next", "", http.StatusNotFound, "not_found"},
		{"не тот метод", http.MethodDelete, "/api/sessions/" + testSession + "/book", "", http.StatusMethodNotAllowed, "method_not_allowed"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(r, tt.method, tt.path, tt.body)
			if rec.Code != tt.wantStatus {
				t.Errorf("статус = %d, ожидался %d (%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("в ответе %q нет %q", rec.Body.String(), tt.wantBody)
			}
		})
	}
}

// waitInBackground начинает ожидание и возвращает функцию, которая его прерывает.
func waitInBackground(t *testing.T, r http.Handler, path string) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		req := httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx)
		r.ServeHTTP(httptest.NewRecorder(), req)
	}()
	return func() {
		cancel()
		<-done
	}
}

func TestWaitLimits(t *testing.T) {
	h := newHandler()
	r := newRouter(h)
	h.PollTimeout = 5 * time.Second
	h.MaxWaitsPerClient, h.MaxGuestWaits = 3, 1

	// Связанная сессия: телефон уже прислал статью.
	do(r, http.MethodPost, "/api/sessions/"+testSession+"/book", `{"type":"article"}`)

	stopGuest := waitInBackground(t, r, "/api/sessions/"+otherSession+"/book/next")
	defer stopGuest()
	waitFor(t, func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.guests == 1 })

	// Второе ожидание несвязанной сессии упирается в общий предел.
	if rec := do(r, http.MethodGet, "/api/sessions/"+strings.Repeat("y", 32)+"/book/next", ""); rec.Code != http.StatusTooManyRequests {
		t.Errorf("гость сверх предела: статус %d", rec.Code)
	}
	// Связанной сессии общий предел для гостей не мешает…
	stopOwner := waitInBackground(t, r, "/api/sessions/"+testSession+"/book/next?after=9223372036854775807")
	defer stopOwner()
	stopOwner2 := waitInBackground(t, r, "/api/sessions/"+testSession+"/phone/next")
	defer stopOwner2()
	waitFor(t, func() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.waits["192.0.2.1"] == 3 })
	// …но с одного адреса больше трёх ожиданий не держат.
	if rec := do(r, http.MethodGet, "/api/sessions/"+testSession+"/phone/next", ""); rec.Code != http.StatusTooManyRequests {
		t.Errorf("четвёртое ожидание с адреса: статус %d", rec.Code)
	}
	// Проверка без ожидания пределов не касается.
	if rec := do(r, http.MethodGet, "/api/sessions/"+testSession+"/phone/next?wait=0", ""); rec.Code != http.StatusNoContent {
		t.Errorf("проверка без ожидания: статус %d", rec.Code)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("условие так и не выполнилось")
		}
		time.Sleep(time.Millisecond)
	}
}
