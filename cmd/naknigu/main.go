package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ilvesBogdan/naknigu/internal/app/naknigu"
	"github.com/ilvesBogdan/naknigu/internal/pkg/logging"
	"github.com/ilvesBogdan/naknigu/internal/pkg/pagefetch"
)

// version подставляется при сборке: -ldflags "-X main.version=1.2.3".
var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "health" {
		os.Exit(health(os.Getenv("NAKNIGU_ADDR")))
	}

	cfg, err := naknigu.LoadConfig(os.Getenv)
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "bad settings:", err)
		os.Exit(2)
	}
	cfg.Version = version
	log := logging.New(os.Stdout, cfg.LogLevel)
	log.Info("server is starting", "address", cfg.Addr, "version", version)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := naknigu.New(cfg, log, pagefetch.New()).Run(ctx); err != nil {
		os.Exit(1)
	}
}

// health спрашивает /api/health у сервера на этой же машине и возвращает
// код выхода: 0 — сервер отвечает.
func health(addr string) int {
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "bad NAKNIGU_ADDR:", err)
		return 1
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	client := http.Client{Timeout: 3 * time.Second}
	// Сервер слушает обычный HTTP: HTTPS снаружи даёт обратный прокси.
	//goland:noinspection HttpUrlsUsage
	resp, err := client.Get("http://" + net.JoinHostPort(host, port) + "/api/health")
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "the server does not answer:", err)
		return 1
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = fmt.Fprintln(os.Stderr, "the server answered with status", resp.StatusCode)
		return 1
	}
	return 0
}
