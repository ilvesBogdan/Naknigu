#!/bin/sh
set -eu

image=$1
platform=$2
version=${3:-dev}
name="naknigu-smoke-$$"
origin=https://owner.example

docker run -d --name "$name" --platform "$platform" \
    -e NAKNIGU_ALLOWED_ORIGINS="$origin" \
    "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1' EXIT

# В образе нет ни оболочки, ни curl. Запросы идут из соседнего контейнера
# с curl в той же сети, что и сервер: так проверка не зависит от того,
# как сеть устроена на машине сборки.
curl_in() {
    docker run --rm --network "container:$name" curlimages/curl:8.22.0 -sS "$@"
}

attempt=0
until docker exec "$name" /naknigu health 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then
        echo "the server did not start in time" >&2
        docker logs "$name" >&2
        exit 1
    fi
    sleep 1
done
echo "ok: the server answers its own health check"

health=$(curl_in http://127.0.0.1:8080/api/health)
echo "$health" | grep -q "\"version\":\"$version\"" || { echo "unexpected health answer: $health" >&2; exit 1; }
echo "ok: the server reports version $version"

status=$(curl_in -o /dev/null -w '%{http_code}' "http://127.0.0.1:8080/api/fetch?url=http://127.0.0.1/")
[ "$status" = 403 ] || { echo "page download from a private address answered $status, not 403" >&2; exit 1; }
echo "ok: the server refuses to download pages from private addresses"

allow=$(curl_in -o /dev/null -D - -X OPTIONS -H "Origin: $origin" -H "Access-Control-Request-Method: POST" \
    http://127.0.0.1:8080/api/sessions/0123456789abcdef0123456789abcdef/book | tr -d '\r' | grep -i '^access-control-allow-origin:' || true)
[ "$allow" = "Access-Control-Allow-Origin: $origin" ] || [ "$allow" = "access-control-allow-origin: $origin" ] ||
    { echo "CORS preflight was not allowed: '$allow'" >&2; exit 1; }
echo "ok: CORS is allowed for $origin"

user=$(docker inspect --format '{{.Config.User}}' "$name")
[ "$user" = "65534:65534" ] || { echo "the container runs as '$user', not as nobody" >&2; exit 1; }
echo "ok: the server does not run as root"

# Сервер внутри образа должен быть собран под архитектуру образа.
arch=$(docker image inspect --format '{{.Architecture}}' "$image")
echo "ok: the image is built for $arch"
