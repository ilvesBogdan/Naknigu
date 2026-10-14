package pagefetch

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/ilvesBogdan/naknigu/internal/pkg/httpx"
)

// Handler — HTTP-обёртка над Fetcher.
type Handler struct {
	fetcher Fetcher
	log     *slog.Logger
}

// NewHandler создаёт обработчик поверх fetcher.
func NewHandler(fetcher Fetcher, log *slog.Logger) *Handler {
	return &Handler{fetcher: fetcher, log: log}
}

// failure описывает, как ошибку скачивания показать клиенту и записать в журнал.
type failure struct {
	err    error
	status int
	code   string
	level  slog.Level
	text   string
}

// Таблица вместо цепочки условий: новая ошибка — это одна строка.
var failures = []failure{
	{ErrBadURL, http.StatusBadRequest, "bad_url",
		slog.LevelWarn, "the address is not a web page address"},
	{ErrPrivateAddress, http.StatusForbidden, "private_address",
		slog.LevelWarn, "the address is in a private network, the download was blocked"},
	{ErrHostNotFound, http.StatusBadGateway, "host_not_found",
		slog.LevelWarn, "the site was not found"},
	{ErrTimeout, http.StatusGatewayTimeout, "timeout",
		slog.LevelWarn, "the site did not answer in time"},
	{ErrNotHTML, http.StatusUnsupportedMediaType, "not_html",
		slog.LevelWarn, "the answer is not a web page"},
	{ErrTooLarge, http.StatusBadGateway, "too_large",
		slog.LevelWarn, "the page is too big"},
	{ErrUnreachable, http.StatusBadGateway, "unreachable",
		slog.LevelError, "no connection to the site"},
}

// Fetch — обработчик GET /api/fetch?url=…: скачивает страницу и отдаёт её.
func (h *Handler) Fetch(w http.ResponseWriter, r *http.Request) {
	log := httpx.Logger(r.Context(), h.log)
	target := r.URL.Query().Get("url")
	host := hostOf(target)

	log.Debug("page download started", "host", host)
	page, err := h.fetcher.Fetch(r.Context(), target)
	if err != nil {
		h.fail(w, r, log, host, err)
		return
	}
	log.Info("page download finished",
		"host", host, "final_host", hostOf(page.FinalURL), "bytes", len(page.Body), "content_type", page.ContentType)

	contentType := page.ContentType
	if contentType == "" {
		contentType = "text/html"
	}
	w.Header().Set("Content-Type", contentType)
	// Чужая страница отдаётся с адреса приложения. Если открыть такой ответ
	// во вкладке, её скрипты получили бы доступ к данным приложения — поэтому
	// браузеру запрещено исполнять в нём что-либо и угадывать его тип.
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Final-Url", page.FinalURL)
	_, _ = w.Write(page.Body)
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, log *slog.Logger, host string, err error) {
	if statusErr, ok := errors.AsType[*StatusError](err); ok {
		log.Warn("the site answered with an error status", "host", host, "site_status", statusErr.Code)
		httpx.WriteJSON(w, http.StatusBadGateway, httpx.ErrorBody{Error: "site_status", Status: statusErr.Code})
		return
	}
	for _, f := range failures {
		if errors.Is(err, f.err) {
			log.Log(r.Context(), f.level, "page download failed: "+f.text, "host", host, "error", err.Error())
			httpx.WriteError(w, f.status, f.code)
			return
		}
	}
	log.Error("page download failed for an unknown reason", "host", host, "error", err.Error())
	httpx.WriteError(w, http.StatusBadGateway, "unreachable")
}

// hostOf возвращает имя сайта для журнала: полный адрес туда не пишем,
// в нём могут быть личные данные.
func hostOf(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return u.Host
}
