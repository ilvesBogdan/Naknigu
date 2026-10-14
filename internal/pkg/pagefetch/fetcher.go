package pagefetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// Ошибки скачивания. Обработчик переводит их в коды для клиента.
var (
	ErrBadURL         = errors.New("the address is not a web page address")
	ErrPrivateAddress = errors.New("the address is in a private network")
	ErrHostNotFound   = errors.New("the site was not found")
	ErrTimeout        = errors.New("the site did not answer in time")
	ErrUnreachable    = errors.New("no connection to the site")
	ErrNotHTML        = errors.New("the answer is not a web page")
	ErrTooLarge       = errors.New("the page is too big")
)

// StatusError — сайт ответил, но не кодом 200.
type StatusError struct{ Code int }

func (e *StatusError) Error() string { return fmt.Sprintf("the site answered with status %d", e.Code) }

// Page — скачанная страница в том виде, в каком её отдал сайт.
type Page struct {
	Body []byte
	// ContentType — заголовок сайта; в нём может быть кодировка страницы.
	// Перекодировать её — дело клиента: в браузере для этого есть TextDecoder.
	ContentType string
	// FinalURL — адрес после перенаправлений: от него считаются
	// относительные ссылки и картинки.
	FinalURL string
}

// Fetcher скачивает страницу по адресу.
type Fetcher interface {
	Fetch(ctx context.Context, rawURL string) (*Page, error)
}

// AddressPolicy решает, можно ли соединяться с адресом.
type AddressPolicy func(netip.Addr) bool

// HTTPFetcher — Fetcher поверх net/http.
type HTTPFetcher struct {
	client    *http.Client
	maxBytes  int64
	userAgent string
}

type settings struct {
	policy   AddressPolicy
	maxBytes int64
}

// timeout — предел времени на скачивание одной страницы.
const timeout = 20 * time.Second

// Option настраивает HTTPFetcher.
type Option func(*settings)

// WithAddressPolicy заменяет правило «только публичные адреса».
func WithAddressPolicy(p AddressPolicy) Option { return func(s *settings) { s.policy = p } }

// WithMaxBytes задаёт предел размера страницы.
func WithMaxBytes(n int64) Option { return func(s *settings) { s.maxBytes = n } }

// New создаёт HTTPFetcher. По умолчанию ему доступны только публичные адреса.
func New(opts ...Option) *HTTPFetcher {
	s := settings{policy: IsPublic, maxBytes: 5 << 20}
	for _, opt := range opts {
		opt(&s)
	}
	dialer := &net.Dialer{
		Timeout: 10 * time.Second,
		// Адрес проверяется в момент соединения, уже после DNS: так защита
		// действует и на перенаправления, и на имена, указывающие внутрь сети.
		Control: func(_, address string, _ syscall.RawConn) error {
			addrPort, err := netip.ParseAddrPort(address)
			if err != nil {
				return err
			}
			if !s.policy(addrPort.Addr()) {
				return ErrPrivateAddress
			}
			return nil
		},
	}
	return &HTTPFetcher{
		client: &http.Client{
			Timeout: timeout,
			// Прокси из окружения не используем: проверяется адрес самого сайта.
			Transport: &http.Transport{DialContext: dialer.DialContext, TLSHandshakeTimeout: 10 * time.Second},
		},
		maxBytes: s.maxBytes,
		// Многие сайты отдают роботам заглушку, поэтому представляемся браузером.
		userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
	}
}

// IsPublic сообщает, что адрес не относится к внутренним и служебным сетям.
func IsPublic(addr netip.Addr) bool {
	addr = addr.Unmap()
	cgnat := netip.MustParsePrefix("100.64.0.0/10")
	return addr.IsValid() &&
		!addr.IsLoopback() &&
		!addr.IsPrivate() &&
		!addr.IsLinkLocalUnicast() &&
		!addr.IsMulticast() &&
		!addr.IsUnspecified() &&
		!cgnat.Contains(addr)
}

// Fetch скачивает страницу.
func (f *HTTPFetcher) Fetch(ctx context.Context, rawURL string) (*Page, error) {
	target, err := url.Parse(rawURL)
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
		return nil, ErrBadURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, ErrBadURL
	}
	req.Header.Set("User-Agent", f.userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("Accept-Language", "ru,en;q=0.8")

	resp, err := f.client.Do(req)
	if err != nil {
		return nil, classify(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, &StatusError{Code: resp.StatusCode}
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType != "" && !strings.Contains(strings.ToLower(contentType), "html") {
		return nil, ErrNotHTML
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, f.maxBytes+1))
	if err != nil {
		return nil, classify(err)
	}
	if int64(len(body)) > f.maxBytes {
		return nil, ErrTooLarge
	}
	return &Page{Body: body, ContentType: contentType, FinalURL: resp.Request.URL.String()}, nil
}

// classify приводит сетевую ошибку к одной из ошибок пакета.
func classify(err error) error {
	var dnsErr *net.DNSError
	var netErr net.Error
	switch {
	case errors.Is(err, ErrPrivateAddress):
		return ErrPrivateAddress
	case errors.As(err, &dnsErr):
		return ErrHostNotFound
	case errors.As(err, &netErr) && netErr.Timeout():
		return ErrTimeout
	}
	// В тексте *url.Error стоит полный адрес страницы, а он в журнал
	// не пишется: в нём бывают личные данные. Оставляем только причину.
	if urlErr, ok := errors.AsType[*url.Error](err); ok {
		err = urlErr.Err
	}
	return fmt.Errorf("%w: %v", ErrUnreachable, err)
}
