package naknigu

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ilvesBogdan/naknigu/internal/pkg/pagefetch"
	"github.com/ilvesBogdan/naknigu/internal/pkg/relay"
)

var quiet = slog.New(slog.NewJSONHandler(io.Discard, nil))

func testConfig() Config {
	return Config{AllowedOrigins: []string{"https://owner.github.io"}, Version: "1.2.3", ShutdownTimeout: time.Second}
}

func TestLoadConfig(t *testing.T) {
	tests := []struct {
		name        string
		env         map[string]string
		wantAddr    string
		wantLevel   slog.Level
		wantOrigins string
		wantProxy   bool
		wantErr     bool
	}{
		{"по умолчанию", nil, "127.0.0.1:8081", slog.LevelInfo, "", false, false},
		{"из окружения", map[string]string{
			"NAKNIGU_ADDR": ":9000", "NAKNIGU_LOG_LEVEL": "debug",
			"NAKNIGU_ALLOWED_ORIGINS": "https://Owner.github.io/, http://localhost:4173", "NAKNIGU_TRUST_PROXY": "true",
		}, ":9000", slog.LevelDebug, "https://owner.github.io,http://localhost:4173", true, false},
		{"неизвестный уровень", map[string]string{"NAKNIGU_LOG_LEVEL": "loud"}, "", 0, "", false, true},
		{"адрес сайта с путём", map[string]string{"NAKNIGU_ALLOWED_ORIGINS": "https://owner.github.io/naknigu/"}, "", 0, "", false, true},
		{"непонятный прокси", map[string]string{"NAKNIGU_TRUST_PROXY": "maybe"}, "", 0, "", false, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := LoadConfig(func(k string) string { return tt.env[k] })
			if (err != nil) != tt.wantErr {
				t.Fatalf("ошибка = %v", err)
			}
			if err != nil {
				return
			}
			if cfg.Addr != tt.wantAddr || cfg.LogLevel != tt.wantLevel || strings.Join(cfg.AllowedOrigins, ",") != tt.wantOrigins || cfg.TrustProxy != tt.wantProxy {
				t.Errorf("cfg = %+v", cfg)
			}
		})
	}
}

func TestRouterAnswersInJSON(t *testing.T) {
	router := NewHandler(testConfig(), quiet, relay.NewHub(), pagefetch.New())
	tests := []struct {
		name, method, path string
		wantStatus         int
		wantBody           string
	}{
		{"проверка здоровья", http.MethodGet, "/api/health", http.StatusOK, `"version":"1.2.3"`},
		{"нет такого пути", http.MethodGet, "/api/nothing", http.StatusNotFound, `"error":"not_found"`},
		{"не тот метод", http.MethodDelete, "/api/health", http.StatusMethodNotAllowed, `"error":"method_not_allowed"`},
		{"скачивание без адреса", http.MethodGet, "/api/fetch", http.StatusBadRequest, `"error":"bad_url"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))
			if rec.Code != tt.wantStatus || !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("ответ: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// Ответ с ошибкой должен нести разрешение CORS: иначе браузер спрячет
// от клиента код ошибки, и телефон не поймёт, что пошло не так.
func TestErrorsCarryCORS(t *testing.T) {
	router := NewHandler(testConfig(), quiet, relay.NewHub(), pagefetch.New())
	req := httptest.NewRequest(http.MethodGet, "/api/fetch", nil)
	req.Header.Set("Origin", "https://owner.github.io")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || rec.Header().Get("Access-Control-Allow-Origin") != "https://owner.github.io" {
		t.Errorf("ответ %d, заголовки %v", rec.Code, rec.Header())
	}
}

func TestServeStopsWhenContextIsCancelled(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	app := New(testConfig(), quiet, pagefetch.New())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- app.Serve(ctx, listener) }()

	// Тестовый сервер слушает обычный HTTP на 127.0.0.1.
	//goland:noinspection HttpUrlsUsage
	resp, err := http.Get("http://" + listener.Addr().String() + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("статус = %d", resp.StatusCode)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("Serve вернул ошибку: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("сервер не остановился")
	}
}
