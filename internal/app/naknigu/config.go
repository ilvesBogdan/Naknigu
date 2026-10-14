package naknigu

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/ilvesBogdan/naknigu/internal/pkg/logging"
)

// Config — настройки сервера. Все берутся из переменных окружения.
type Config struct {
	// Addr — адрес, на котором слушать.
	Addr string
	// LogLevel — с какого уровня писать журнал.
	LogLevel slog.Level
	// ShutdownTimeout — сколько ждать открытые запросы при остановке.
	ShutdownTimeout time.Duration
	// AllowedOrigins — сайты, чьим страницам браузер разрешит обращаться
	// к API (там лежат клиенты). Пусто — клиенты на том же адресе, что и API.
	AllowedOrigins []string
	// TrustProxy — сервер стоит за обратным прокси, и адрес клиента берётся
	// из заголовка X-Forwarded-For.
	TrustProxy bool
	// Version — версия сборки; её показывает /api/health.
	Version string
}

// LoadConfig читает настройки через getenv (обычно os.Getenv).
func LoadConfig(getenv func(string) string) (Config, error) {
	cfg := Config{Addr: "127.0.0.1:8081", ShutdownTimeout: 10 * time.Second}
	if v := getenv("NAKNIGU_ADDR"); v != "" {
		cfg.Addr = v
	}
	var errs []error
	level, err := logging.ParseLevel(getenv("NAKNIGU_LOG_LEVEL"))
	if err != nil {
		errs = append(errs, fmt.Errorf("NAKNIGU_LOG_LEVEL: %w", err))
	}
	cfg.LogLevel = level

	if cfg.AllowedOrigins, err = parseOrigins(getenv("NAKNIGU_ALLOWED_ORIGINS")); err != nil {
		errs = append(errs, fmt.Errorf("NAKNIGU_ALLOWED_ORIGINS: %w", err))
	}
	switch v := strings.ToLower(strings.TrimSpace(getenv("NAKNIGU_TRUST_PROXY"))); v {
	case "", "false", "0", "no":
	case "true", "1", "yes":
		cfg.TrustProxy = true
	default:
		errs = append(errs, fmt.Errorf("NAKNIGU_TRUST_PROXY: %q is not true or false", v))
	}
	if err := errors.Join(errs...); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// parseOrigins разбирает список адресов сайтов через запятую. Адрес сайта —
// только схема и имя (https://owner.github.io), без пути: именно так браузер
// пишет его в заголовке Origin.
func parseOrigins(list string) ([]string, error) {
	var origins []string
	for _, raw := range strings.Split(list, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" ||
			(u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return nil, fmt.Errorf("%q is not a site address like https://owner.github.io", raw)
		}
		origins = append(origins, u.Scheme+"://"+strings.ToLower(u.Host))
	}
	return origins, nil
}
