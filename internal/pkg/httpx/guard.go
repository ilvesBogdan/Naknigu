package httpx

import (
	"compress/gzip"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// CORS разрешает страницам с адресов origins (например, https://<имя>.github.io)
// обращаться к API из браузера. Клиенты лежат на GitHub Pages, а сервер —
// на другом адресе, поэтому без этого браузер не отдал бы им ответы.
//
// Запросы с телом в JSON браузер сначала «согласует» запросом OPTIONS — на него отвечает
// этот слой, до маршрутов дело не доходит. Ответ на согласование браузер
// помнит до двух часов.
func CORS(origins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(origins))
	for _, origin := range origins {
		allowed[origin] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			preflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
			h := w.Header()
			h.Add("Vary", "Origin")
			if origin != "" && allowed[origin] {
				h.Set("Access-Control-Allow-Origin", origin)
				// Без этого браузер спрячет от клиента адрес страницы после
				// перенаправлений и номер запроса.
				h.Set("Access-Control-Expose-Headers", "X-Final-Url, X-Request-Id")
				if preflight {
					h.Set("Access-Control-Allow-Methods", "GET, POST")
					h.Set("Access-Control-Allow-Headers", "Content-Type")
					h.Set("Access-Control-Max-Age", "7200")
				}
			}
			if preflight {
				// Чужой странице отвечаем тем же кодом, но без разрешений:
				// браузер сам не пустит её дальше.
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimit ограничивает частоту запросов с одного адреса: в среднем
// perSecond запросов в секунду, разом — не больше burst. Лишним запросам
// сервер отвечает 429 с кодом too_many_requests. Адреса IPv6 считаются
// по сети /64: столько обычно выдают одному абоненту.
func RateLimit(log *slog.Logger, perSecond float64, burst int) func(http.Handler) http.Handler {
	l := newLimiter(perSecond, burst, time.Now)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.allow(limitKey(ClientIP(r))) {
				Logger(r.Context(), log).Warn("too many requests from one client, the request was refused")
				w.Header().Set("Retry-After", "1")
				WriteError(w, http.StatusTooManyRequests, "too_many_requests")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func limitKey(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.To4() != nil {
		return ip
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String()
}

// maxBuckets — сколько адресов помнить. Больше — значит, запросы идут
// со множества адресов; тогда память очищается, а не растёт без конца.
const maxBuckets = 10000

type bucket struct {
	tokens float64
	seen   time.Time
}

// limiter — «ведро с жетонами» на каждый адрес: запрос забирает жетон,
// жетоны прибывают со скоростью rate, но не больше burst.
type limiter struct {
	rate, burst float64
	now         func() time.Time

	mu      sync.Mutex
	buckets map[string]*bucket
}

func newLimiter(perSecond float64, burst int, now func() time.Time) *limiter {
	return &limiter{rate: perSecond, burst: float64(burst), now: now, buckets: map[string]*bucket{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b, ok := l.buckets[key]
	if !ok {
		if len(l.buckets) >= maxBuckets {
			l.prune(now)
		}
		b = &bucket{tokens: l.burst}
		l.buckets[key] = b
	} else {
		b.tokens = min(l.burst, b.tokens+now.Sub(b.seen).Seconds()*l.rate)
	}
	b.seen = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// prune забывает адреса, у которых ведро уже наполнилось бы снова. Если
// таких нет, забывает всех: лучше на время ослабить защиту, чем занять
// всю память.
func (l *limiter) prune(now time.Time) {
	full := time.Duration(l.burst / l.rate * float64(time.Second))
	for key, b := range l.buckets {
		if now.Sub(b.seen) >= full {
			delete(l.buckets, key)
		}
	}
	if len(l.buckets) >= maxBuckets {
		clear(l.buckets)
	}
}

// Gzip сжимает ответы в JSON и текстовые ответы, если клиент это умеет.
// Статья с разметкой занимает десятки килобайт, а сеть у электронной книги
// медленная: в сжатом виде она приходит в несколько раз быстрее.
func Gzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipWriter{ResponseWriter: w}
		defer gw.close()
		next.ServeHTTP(gw, r)
	})
}

// gzipWriter решает, сжимать ли ответ, когда обработчик начинает его писать:
// к этому моменту известны код ответа и тип содержимого.
type gzipWriter struct {
	http.ResponseWriter
	gz      *gzip.Writer
	started bool
}

func (g *gzipWriter) WriteHeader(status int) {
	if !g.started {
		g.started = true
		h := g.Header()
		h.Add("Vary", "Accept-Encoding")
		hasBody := status != http.StatusNoContent && status != http.StatusNotModified
		if hasBody && h.Get("Content-Encoding") == "" && compressible(h.Get("Content-Type")) {
			h.Set("Content-Encoding", "gzip")
			h.Del("Content-Length")
			g.gz = gzip.NewWriter(g.ResponseWriter)
		}
	}
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipWriter) Write(p []byte) (int, error) {
	if !g.started {
		g.WriteHeader(http.StatusOK)
	}
	if g.gz != nil {
		return g.gz.Write(p)
	}
	return g.ResponseWriter.Write(p)
}

func (g *gzipWriter) close() {
	if g.gz != nil {
		_ = g.gz.Close()
	}
}

func compressible(contentType string) bool {
	return strings.HasPrefix(contentType, "application/json") || strings.HasPrefix(contentType, "text/")
}
