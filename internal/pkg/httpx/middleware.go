package httpx

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"time"
)

type contextKey int

const (
	loggerKey contextKey = iota
	clientKey
)

// Logger возвращает журнал запроса: в каждой его строке уже есть request_id.
// Вне запроса возвращает fallback.
func Logger(ctx context.Context, fallback *slog.Logger) *slog.Logger {
	if log, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
		return log
	}
	return fallback
}

// RealIP определяет адрес клиента и кладёт его в контекст запроса (см. ClientIP).
//
// Если сервер стоит за обратным прокси (Traefik в Coolify, nginx), прямой
// собеседник сервера — сам прокси, а адрес клиента прокси дописывает в конец
// заголовка X-Forwarded-For. Верить этому заголовку можно только за прокси:
// без него клиент впишет туда что угодно. Поэтому trustProxy включается
// настройкой, и берётся только последний адрес — тот, что дописал прокси.
func RealIP(trustProxy bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := remoteHost(r.RemoteAddr)
			if trustProxy {
				if forwarded := lastForwarded(r); forwarded != "" {
					ip = forwarded
				}
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientKey, ip)))
		})
	}
}

// ClientIP возвращает адрес клиента, найденный RealIP, а без него — адрес
// собеседника сервера.
func ClientIP(r *http.Request) string {
	if ip, ok := r.Context().Value(clientKey).(string); ok {
		return ip
	}
	return remoteHost(r.RemoteAddr)
}

func remoteHost(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

func lastForwarded(r *http.Request) string {
	values := r.Header.Values("X-Forwarded-For")
	if len(values) == 0 {
		return ""
	}
	parts := strings.Split(values[len(values)-1], ",")
	ip := strings.TrimSpace(parts[len(parts)-1])
	if net.ParseIP(ip) == nil {
		return ""
	}
	return ip
}

// statusRecorder запоминает код и размер ответа для журнала.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(p []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(p)
	r.bytes += n
	return n, err
}

// RequestLog даёт запросу номер, кладёт журнал с этим номером в контекст
// и записывает начало и конец каждого запроса.
//
// В журнал попадает шаблон маршрута (/api/sessions/{session}/book), а не сам
// адрес: в адресе стоит идентификатор сессии, а он открывает доступ к её
// сообщениям. Параметры запроса не пишутся тоже: в них бывает полный адрес
// страницы, которую читает человек. Сам адрес пишется только у запросов,
// не попавших ни в один маршрут, — по нему видно, что искали.
func RequestLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-Id")
			if id == "" || len(id) > 64 {
				id = newRequestID()
			}
			w.Header().Set("X-Request-Id", id)

			reqLog := log.With("request_id", id)
			reqLog.Debug("request started", "method", r.Method, "client", ClientIP(r), "user_agent", r.UserAgent())

			rec := &statusRecorder{ResponseWriter: w}
			start := time.Now()
			req := r.WithContext(context.WithValue(r.Context(), loggerKey, reqLog))
			next.ServeHTTP(rec, req)

			attrs := []any{
				"method", r.Method, "route", req.Pattern, "status", rec.status,
				"bytes", rec.bytes, "duration_ms", time.Since(start).Milliseconds(), "client", ClientIP(r),
			}
			if req.Pattern == "" || req.Pattern == "/" {
				attrs = append(attrs, "path", r.URL.Path)
			}
			switch {
			case rec.status == 0:
				// Клиент ушёл раньше, чем мы ответили (обычно при долгом ожидании).
				reqLog.Debug("request ended, the client went away", attrs...)
			case rec.status >= 500:
				reqLog.Error("request finished with a server error", attrs...)
			case rec.status >= 400:
				reqLog.Warn("request finished with a client error", attrs...)
			default:
				reqLog.Info("request finished", attrs...)
			}
		})
	}
}

// Recover не даёт панике в обработчике уронить сервер: пишет её в журнал
// и отвечает ошибкой 500.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if v := recover(); v != nil {
					Logger(r.Context(), log).Error("the handler crashed",
						"panic", v, "stack", string(debug.Stack()))
					WriteError(w, http.StatusInternalServerError, "internal")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func newRequestID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
