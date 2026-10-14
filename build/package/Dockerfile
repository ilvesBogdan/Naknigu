# syntax=docker/dockerfile:1
#
# Образ сервера API: один исполняемый файл на Go и корневые сертификаты,
# больше ничего — ни оболочки, ни пакетов. Клиенты (страница книги,
# приложение телефона, витрина) публикуются отдельно, на GitHub Pages.
#
# Контекст сборки — корень проекта:
#   docker build -f build/package/Dockerfile --build-arg VERSION=1.2.3 -t naknigu .
#
# Сборочная стадия работает на архитектуре машины сборки ($BUILDPLATFORM)
# и собирает сервер под целевую архитектуру: так образ под arm64 и amd64
# собирается без медленной эмуляции.

ARG GO_VERSION=1.27
# Задаётся сборщиком сам; объявлен, чтобы его было видно в FROM ниже.
ARG BUILDPLATFORM

# --- Сервер на Go: проверки, тесты, сборка под целевую архитектуру ---
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS server
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
# Внешних зависимостей у сервера нет — только стандартная библиотека.
COPY go.mod ./
# Путь в кавычках: иначе разбор Dockerfile в IDE принимает cmd за инструкцию CMD.
COPY ["cmd", "./cmd"]
COPY internal ./internal
# Тест сверяет маршруты сервера с описанием API.
COPY api ./api
RUN go vet ./... && go test ./...
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/naknigu ./cmd/naknigu

# --- Итоговый образ ---
FROM scratch
ARG VERSION=dev
LABEL org.opencontainers.image.title="naknigu" \
      org.opencontainers.image.description="naknigu API server: relays messages between the phone and the e-reader and downloads pages for reader mode" \
      org.opencontainers.image.source="https://github.com/ilvesBogdan/naknigu" \
      org.opencontainers.image.version="${VERSION}"
# Сертификаты нужны, чтобы скачивать страницы по HTTPS.
COPY --from=server /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=server /out/naknigu /naknigu
# Не root: серверу не нужны никакие права.
USER 65534:65534
ENV NAKNIGU_ADDR=:8080
EXPOSE 8080
# В образе нет ни wget, ни curl: здоровье проверяет сам сервер.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD ["/naknigu", "health"]
ENTRYPOINT ["/naknigu"]
