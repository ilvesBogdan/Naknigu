package httpx

import (
	"net/http"
	"slices"
	"strings"
)

// Route — один маршрут API.
type Route struct {
	Method string
	// Path — шаблон адреса в формате http.ServeMux: /api/sessions/{session}/book.
	Path    string
	Handler http.HandlerFunc
}

// Router собирает маршруты в один обработчик. На метод, которого у адреса
// нет, клиент получает 405, на адрес, которого нет вовсе, — 404; оба ответа
// в JSON.
func Router(routes []Route) http.Handler {
	mux := http.NewServeMux()
	byPath := map[string]map[string]http.HandlerFunc{}
	var paths []string
	for _, route := range routes {
		if byPath[route.Path] == nil {
			byPath[route.Path] = map[string]http.HandlerFunc{}
			paths = append(paths, route.Path)
		}
		byPath[route.Path][route.Method] = route.Handler
	}
	for _, path := range paths {
		mux.HandleFunc(path, Methods(byPath[path]))
	}
	mux.HandleFunc("/", NotFound)
	return mux
}

// Methods возвращает обработчик, который выбирает действие по методу запроса,
// а на остальные методы отвечает ошибкой 405 в JSON.
func Methods(byMethod map[string]http.HandlerFunc) http.HandlerFunc {
	allowed := make([]string, 0, len(byMethod))
	for method := range byMethod {
		allowed = append(allowed, method)
	}
	slices.Sort(allowed)
	allow := strings.Join(allowed, ", ")

	return func(w http.ResponseWriter, r *http.Request) {
		if h, ok := byMethod[r.Method]; ok {
			h(w, r)
			return
		}
		w.Header().Set("Allow", allow)
		WriteError(w, http.StatusMethodNotAllowed, "method_not_allowed")
	}
}

// NotFound отвечает ошибкой 404 в JSON.
func NotFound(w http.ResponseWriter, _ *http.Request) {
	WriteError(w, http.StatusNotFound, "not_found")
}
