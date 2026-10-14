package httpx

import (
	"compress/gzip"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

var quiet = slog.New(slog.NewJSONHandler(io.Discard, nil))

func ok(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func TestCORS(t *testing.T) {
	h := CORS([]string{"https://owner.github.io"})(http.HandlerFunc(ok))
	tests := []struct {
		name, method, origin string
		preflight            bool
		wantStatus           int
		wantAllow            string
	}{
		{"свой сайт", http.MethodGet, "https://owner.github.io", false, http.StatusOK, "https://owner.github.io"},
		{"согласование со своим сайтом", http.MethodOptions, "https://owner.github.io", true, http.StatusNoContent, "https://owner.github.io"},
		{"чужой сайт", http.MethodGet, "https://evil.example", false, http.StatusOK, ""},
		{"согласование с чужим сайтом", http.MethodOptions, "https://evil.example", true, http.StatusNoContent, ""},
		{"не из браузера", http.MethodGet, "", false, http.StatusOK, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/health", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			if tt.preflight {
				req.Header.Set("Access-Control-Request-Method", http.MethodPost)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.wantStatus || rec.Header().Get("Access-Control-Allow-Origin") != tt.wantAllow {
				t.Errorf("ответ %d, заголовки %v", rec.Code, rec.Header())
			}
			if tt.preflight && tt.wantAllow != "" && rec.Header().Get("Access-Control-Allow-Headers") != "Content-Type" {
				t.Errorf("согласование не разрешает JSON: %v", rec.Header())
			}
		})
	}
}

func TestLimiter(t *testing.T) {
	now := time.Unix(1000, 0)
	l := newLimiter(1, 3, func() time.Time { return now })
	for i := range 3 {
		if !l.allow("a") {
			t.Fatalf("запрос %d из запаса отклонён", i+1)
		}
	}
	if l.allow("a") {
		t.Error("четвёртый запрос подряд пропущен")
	}
	if !l.allow("b") {
		t.Error("другой адрес пострадал от чужих запросов")
	}
	now = now.Add(time.Second)
	if !l.allow("a") {
		t.Error("через секунду жетон не появился")
	}
}

func TestLimitKeyGroupsIPv6Network(t *testing.T) {
	if limitKey("2001:db8:1:2:aaaa::1") != limitKey("2001:db8:1:2:bbbb::2") {
		t.Error("адреса одной сети /64 считаются по отдельности")
	}
	if limitKey("203.0.113.1") == limitKey("203.0.113.2") {
		t.Error("адреса IPv4 склеились")
	}
}

func TestRealIP(t *testing.T) {
	tests := []struct {
		name      string
		trust     bool
		forwarded string
		want      string
	}{
		{"без прокси заголовку не верим", false, "198.51.100.7", "192.0.2.1"},
		{"за прокси берём последний адрес", true, "10.0.0.1, 198.51.100.7", "198.51.100.7"},
		{"за прокси без заголовка", true, "", "192.0.2.1"},
		{"мусор в заголовке", true, "not-an-ip", "192.0.2.1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got string
			h := RealIP(tt.trust)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = ClientIP(r) }))
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = "192.0.2.1:5000"
			if tt.forwarded != "" {
				req.Header.Set("X-Forwarded-For", tt.forwarded)
			}
			h.ServeHTTP(httptest.NewRecorder(), req)
			if got != tt.want {
				t.Errorf("адрес клиента = %q, ожидался %q", got, tt.want)
			}
		})
	}
}

func TestRateLimitAnswers429(t *testing.T) {
	h := RateLimit(quiet, 0.001, 1)(http.HandlerFunc(ok))
	first, second := httptest.NewRecorder(), httptest.NewRecorder()
	h.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/", nil))
	h.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/", nil))
	if first.Code != http.StatusOK || second.Code != http.StatusTooManyRequests {
		t.Errorf("ответы %d и %d", first.Code, second.Code)
	}
}

func TestGzip(t *testing.T) {
	h := Gzip(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/empty" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		ok(w, r)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("ответ не сжат: %v", rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(zr)
	if string(body) != "{\"status\":\"ok\"}\n" {
		t.Errorf("после распаковки: %q", body)
	}

	empty := httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/empty", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	h.ServeHTTP(empty, req)
	if empty.Code != http.StatusNoContent || empty.Header().Get("Content-Encoding") != "" || empty.Body.Len() != 0 {
		t.Errorf("пустой ответ испорчен: %d %v %q", empty.Code, empty.Header(), empty.Body.String())
	}

	plain := httptest.NewRecorder()
	h.ServeHTTP(plain, httptest.NewRequest(http.MethodGet, "/", nil))
	if plain.Header().Get("Content-Encoding") != "" {
		t.Error("сжат ответ клиенту, который сжатия не просил")
	}
}

func TestRouter(t *testing.T) {
	h := Router([]Route{
		{Method: http.MethodGet, Path: "/api/open", Handler: ok},
		{Method: http.MethodPost, Path: "/api/open", Handler: ok},
	})

	tests := []struct {
		name, method, path string
		wantStatus         int
	}{
		{"открытый маршрут", http.MethodGet, "/api/open", http.StatusOK},
		{"второй метод того же адреса", http.MethodPost, "/api/open", http.StatusOK},
		{"не тот метод", http.MethodDelete, "/api/open", http.StatusMethodNotAllowed},
		{"нет такого адреса", http.MethodGet, "/api/nothing", http.StatusNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))
			if rec.Code != tt.wantStatus {
				t.Errorf("статус = %d, ожидался %d", rec.Code, tt.wantStatus)
			}
		})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/open", nil))
	if rec.Header().Get("Allow") != "GET, POST" {
		t.Errorf("Allow = %q", rec.Header().Get("Allow"))
	}
}
