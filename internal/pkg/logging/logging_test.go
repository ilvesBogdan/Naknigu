package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestParseLevel(t *testing.T) {
	tests := []struct {
		in      string
		want    slog.Level
		wantErr bool
	}{
		{"debug", slog.LevelDebug, false},
		{"INFO", slog.LevelInfo, false},
		{"", slog.LevelInfo, false},
		{" warn ", slog.LevelWarn, false},
		{"warning", slog.LevelWarn, false},
		{"error", slog.LevelError, false},
		{"loud", slog.LevelInfo, true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := ParseLevel(tt.in)
			if got != tt.want || (err != nil) != tt.wantErr {
				t.Errorf("ParseLevel(%q) = %v, %v", tt.in, got, err)
			}
		})
	}
}

func TestNewWritesJSONFromLevel(t *testing.T) {
	var buf bytes.Buffer
	log := New(&buf, slog.LevelInfo)
	log.Debug("this line is hidden")
	log.Info("server is ready", "port", 8081)

	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("в журнале не одна JSON-строка: %v (%s)", err, buf.String())
	}
	if line["msg"] != "server is ready" || line["level"] != "INFO" || line["port"] != float64(8081) {
		t.Errorf("строка журнала: %v", line)
	}
}
