package pagefetch

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

func TestIsPublic(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"93.184.216.34", true},
		{"2606:4700::6810:84e5", true},
		{"127.0.0.1", false},
		{"::1", false},
		{"10.0.0.5", false},
		{"172.16.3.1", false},
		{"192.168.1.1", false},
		{"169.254.169.254", false},
		{"100.64.0.1", false},
		{"0.0.0.0", false},
		{"fe80::1", false},
		{"fd00::1", false},
		{"::ffff:192.168.1.1", false},
		{"224.0.0.1", false},
	}
	for _, tt := range tests {
		t.Run(tt.addr, func(t *testing.T) {
			if got := IsPublic(netip.MustParseAddr(tt.addr)); got != tt.want {
				t.Errorf("IsPublic(%s) = %v, ожидалось %v", tt.addr, got, tt.want)
			}
		})
	}
}

// site — «чужой сайт» для тестов; слушает на 127.0.0.1.
func site(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/article", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=windows-1251")
		_, _ = w.Write([]byte{0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2}) // «Привет» в windows-1251
	})
	mux.HandleFunc("/moved", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/article", http.StatusFound)
	})
	mux.HandleFunc("/pdf", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = io.WriteString(w, "%PDF")
	})
	mux.HandleFunc("/big", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, strings.Repeat("a", 2000))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func allowAll(netip.Addr) bool { return true }

func TestFetch(t *testing.T) {
	remote := site(t)
	// Тестовый сайт живёт на 127.0.0.1, поэтому правило адресов отключено.
	f := New(WithAddressPolicy(allowAll), WithMaxBytes(1000))

	t.Run("страница отдаётся как есть", func(t *testing.T) {
		page, err := f.Fetch(context.Background(), remote.URL+"/moved")
		if err != nil {
			t.Fatal(err)
		}
		// Байты не перекодированы, кодировка и итоговый адрес сохранены.
		if len(page.Body) != 6 || page.Body[0] != 0xcf {
			t.Errorf("тело изменено: %v", page.Body)
		}
		if page.ContentType != "text/html; charset=windows-1251" || page.FinalURL != remote.URL+"/article" {
			t.Errorf("ContentType = %q, FinalURL = %q", page.ContentType, page.FinalURL)
		}
	})

	failures := []struct {
		name, target string
		want         error
	}{
		{"не HTML", remote.URL + "/pdf", ErrNotHTML},
		{"слишком большая", remote.URL + "/big", ErrTooLarge},
		{"не http", "file:///etc/passwd", ErrBadURL},
		{"пустой адрес", "", ErrBadURL},
		{"без имени сайта", "https:///path", ErrBadURL},
	}
	for _, tt := range failures {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := f.Fetch(context.Background(), tt.target); !errors.Is(err, tt.want) {
				t.Errorf("ошибка = %v, ожидалась %v", err, tt.want)
			}
		})
	}

	t.Run("сайт ответил ошибкой", func(t *testing.T) {
		_, err := f.Fetch(context.Background(), remote.URL+"/missing")
		statusErr, ok := errors.AsType[*StatusError](err)
		if !ok || statusErr.Code != http.StatusNotFound {
			t.Errorf("ошибка = %v", err)
		}
	})
}

func TestFetchBlocksPrivateAddresses(t *testing.T) {
	remote := site(t)
	// Настройки по умолчанию: до сайта на 127.0.0.1 дойти нельзя.
	if _, err := New().Fetch(context.Background(), remote.URL+"/article"); !errors.Is(err, ErrPrivateAddress) {
		t.Errorf("ошибка = %v, ожидалась ErrPrivateAddress", err)
	}
}
