package naknigu

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/ilvesBogdan/naknigu/internal/pkg/httpx"
	"github.com/ilvesBogdan/naknigu/internal/pkg/pagefetch"
	"github.com/ilvesBogdan/naknigu/internal/pkg/relay"
)

// Частота запросов с одного адреса. Телефон при подготовке статьи проверяет
// до 30 ссылок по 6 разом, и каждой проверке браузер предшествует запрос
// согласования CORS, — запаса в 120 запросов на это хватает с избытком.
const (
	requestsPerSecond = 10
	requestsBurst     = 120
)

// App — собранный сервер.
type App struct {
	cfg     Config
	log     *slog.Logger
	handler http.Handler
}

// New собирает сервер. fetcher передаётся снаружи, чтобы в тестах
// подменить сеть.
func New(cfg Config, log *slog.Logger, fetcher pagefetch.Fetcher) *App {
	return &App{cfg: cfg, log: log, handler: NewHandler(cfg, log, relay.NewHub(), fetcher)}
}

// routes — все маршруты API. Ровно они описаны в api/openapi.yaml: это
// проверяет TestOpenAPIMatchesRoutes, а клиентов — web/shared/contract.test.ts.
func routes(cfg Config, log *slog.Logger, hub *relay.Hub, fetcher pagefetch.Fetcher) []httpx.Route {
	sessions := relay.NewHandler(hub, log.With("part", "relay"))
	pages := pagefetch.NewHandler(fetcher, log.With("part", "pagefetch"))
	health := func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": cfg.Version})
	}
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/api/health", Handler: health},
		{Method: http.MethodGet, Path: "/api/fetch", Handler: pages.Fetch},
		{Method: http.MethodPost, Path: "/api/sessions/{session}/book", Handler: sessions.Publish(relay.Book)},
		{Method: http.MethodPost, Path: "/api/sessions/{session}/phone", Handler: sessions.Publish(relay.Phone)},
		{Method: http.MethodGet, Path: "/api/sessions/{session}/book/next", Handler: sessions.Next(relay.Book)},
		{Method: http.MethodGet, Path: "/api/sessions/{session}/phone/next", Handler: sessions.Next(relay.Phone)},
	}
}

// NewHandler собирает маршруты и оборачивает их в общие слои.
func NewHandler(cfg Config, log *slog.Logger, hub *relay.Hub, fetcher pagefetch.Fetcher) http.Handler {
	router := httpx.Router(routes(cfg, log, hub, fetcher))

	layers := []func(http.Handler) http.Handler{
		httpx.RealIP(cfg.TrustProxy),
		httpx.RequestLog(log),
		httpx.Recover(log),
		httpx.CORS(cfg.AllowedOrigins),
		httpx.RateLimit(log, requestsPerSecond, requestsBurst),
		httpx.Gzip,
	}
	handler := router
	for i := len(layers) - 1; i >= 0; i-- {
		handler = layers[i](handler)
	}
	return handler
}

// Run слушает адрес из настроек, пока ctx не отменён, затем даёт открытым
// запросам завершиться и останавливается.
func (a *App) Run(ctx context.Context) error {
	listener, err := net.Listen("tcp", a.cfg.Addr)
	if err != nil {
		a.log.Error("the server cannot listen on the address", "address", a.cfg.Addr, "error", err.Error())
		return err
	}
	return a.Serve(ctx, listener)
}

// Serve — то же, что Run, но на готовом listener.
func (a *App) Serve(ctx context.Context, listener net.Listener) error {
	srv := &http.Server{
		Handler:           a.handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	a.log.Info("server is ready", "address", listener.Addr().String(), "log_level", a.cfg.LogLevel.String(),
		"version", a.cfg.Version, "allowed_origins", a.cfg.AllowedOrigins, "trust_proxy", a.cfg.TrustProxy)

	failed := make(chan error, 1)
	go func() { failed <- srv.Serve(listener) }()

	select {
	case err := <-failed:
		a.log.Error("the server stopped because of an error", "error", err.Error())
		return err
	case <-ctx.Done():
	}

	a.log.Info("server is stopping, waiting for open requests", "max_wait_ms", a.cfg.ShutdownTimeout.Milliseconds())
	shutdownCtx, cancel := context.WithTimeout(context.Background(), a.cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		a.log.Error("the server did not stop cleanly", "error", err.Error())
		return err
	}
	a.log.Info("server stopped")
	return nil
}
