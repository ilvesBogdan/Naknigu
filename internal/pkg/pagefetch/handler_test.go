package pagefetch

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// stubFetcher подменяет сеть: обработчик проверяется отдельно от неё.
type stubFetcher struct {
	page *Page
	err  error
}

func (s stubFetcher) Fetch(context.Context, string) (*Page, error) { return s.page, s.err }

func call(f Fetcher) *httptest.ResponseRecorder {
	h := NewHandler(f, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	rec := httptest.NewRecorder()
	target := "/api/fetch?url=" + url.QueryEscape("https://example.com/a")
	h.Fetch(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestHandlerPassesPageThrough(t *testing.T) {
	rec := call(stubFetcher{page: &Page{
		Body: []byte("<p>hi</p>"), ContentType: "text/html; charset=koi8-r", FinalURL: "https://example.com/b",
	}})
	if rec.Code != http.StatusOK || rec.Body.String() != "<p>hi</p>" {
		t.Errorf("ответ: %d %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Security-Policy") != "sandbox" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("чужая страница не должна исполняться с адреса приложения: %v", rec.Header())
	}
	if rec.Header().Get("Content-Type") != "text/html; charset=koi8-r" || rec.Header().Get("X-Final-Url") != "https://example.com/b" {
		t.Errorf("заголовки: %v", rec.Header())
	}
}

func TestHandlerErrorCodes(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantBody   string
	}{
		{"плохой адрес", ErrBadURL, http.StatusBadRequest, `"error":"bad_url"`},
		{"внутренняя сеть", ErrPrivateAddress, http.StatusForbidden, `"error":"private_address"`},
		{"сайт не найден", ErrHostNotFound, http.StatusBadGateway, `"error":"host_not_found"`},
		{"нет ответа", ErrTimeout, http.StatusGatewayTimeout, `"error":"timeout"`},
		{"не страница", ErrNotHTML, http.StatusUnsupportedMediaType, `"error":"not_html"`},
		{"большая", ErrTooLarge, http.StatusBadGateway, `"error":"too_large"`},
		{"нет связи", fmt.Errorf("%w: reset", ErrUnreachable), http.StatusBadGateway, `"error":"unreachable"`},
		{"код сайта", &StatusError{Code: 403}, http.StatusBadGateway, `"error":"site_status","status":403`},
		{"неизвестная", fmt.Errorf("surprise"), http.StatusBadGateway, `"error":"unreachable"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := call(stubFetcher{err: tt.err})
			if rec.Code != tt.wantStatus || !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("ответ: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
}
