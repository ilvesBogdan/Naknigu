package httpx

import (
	"encoding/json"
	"net/http"
)

// ErrorBody — тело ответа с ошибкой. Code — короткий код, который клиент
// сам переводит на язык пользователя; текста для людей сервер не отдаёт.
type ErrorBody struct {
	Error  string `json:"error"`
	Status int    `json:"status,omitempty"` // код ответа чужого сайта, если ошибка о нём
}

// WriteJSON отправляет v как JSON с кодом status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError отправляет ошибку с кодом code.
func WriteError(w http.ResponseWriter, status int, code string) {
	WriteJSON(w, status, ErrorBody{Error: code})
}
