package httpx

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// logLines разбирает журнал: по одной JSON-записи на строку.
func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		var line map[string]any
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			t.Fatalf("строка журнала не JSON: %q", raw)
		}
		lines = append(lines, line)
	}
	return lines
}

func TestRequestLogLevelByStatus(t *testing.T) {
	tests := []struct {
		name      string
		status    int
		wantLevel string
	}{
		{"успех", http.StatusOK, "INFO"},
		{"ошибка клиента", http.StatusBadRequest, "WARN"},
		{"ошибка сервера", http.StatusBadGateway, "ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			log := slog.New(slog.NewJSONHandler(&buf, nil))
			h := RequestLog(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Logger(r.Context(), log).Info("inside the handler")
				w.WriteHeader(tt.status)
			}))

			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))

			lines := logLines(t, &buf)
			last := lines[len(lines)-1]
			if last["level"] != tt.wantLevel || last["status"] != float64(tt.status) {
				t.Errorf("итоговая запись: %v", last)
			}
			// Номер запроса один и тот же в заголовке и во всех записях.
			id := rec.Header().Get("X-Request-Id")
			if id == "" {
				t.Fatal("нет заголовка X-Request-Id")
			}
			for _, line := range lines {
				if line["request_id"] != id {
					t.Errorf("запись без номера запроса: %v", line)
				}
			}
		})
	}
}

func TestRecoverTurnsPanicInto500(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&buf, nil))
	h := Recover(log)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), `"internal"`) {
		t.Errorf("ответ: %d %s", rec.Code, rec.Body.String())
	}
	if line := logLines(t, &buf)[0]; line["level"] != "ERROR" || line["panic"] != "boom" {
		t.Errorf("запись журнала: %v", line)
	}
}
