#!/bin/sh
# Сборка клиента книги в dist/.
#
#   NAKNIGU_API_URL=https://… sh build.sh
#
# NAKNIGU_API_URL — адрес сервера API; пусто — API на том же сайте.
#
# Страница книги хранится в кэше и открывается без сети (см. static/sw.js),
# поэтому у каждой сборки есть номер: он стоит в адресах файлов
# (book.js?v=…) и зашит в сам код. По нему запущенная страница понимает,
# что на сайте появилась новая версия.
set -eu
cd "$(dirname "$0")"

API_URL=${NAKNIGU_API_URL:-}
# Адрес попадает в код как есть, поэтому принимаем только адрес сайта.
if [ -n "$API_URL" ] && ! printf '%s' "$API_URL" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'; then
    echo "NAKNIGU_API_URL must look like https://host or https://host:port, without a path" >&2
    exit 1
fi

# Номер сборки — контрольная сумма исходников и адреса API: меняется только вместе с ними.
BUILD=$( (cat src/*.ts ../shared/*.ts static/* locales/*.json; printf '%s' "$API_URL") | cksum | cut -d' ' -f1)

bundle() {
    esbuild "$1" --bundle --minify --charset=utf8 --format=iife --target=es2015 \
        --define:BUILD="\"$BUILD\"" --define:__API_URL__="\"$API_URL\"" --outfile="$2"
}
bundle src/main.ts dist/book.js
bundle src/qr.ts dist/qr.js
esbuild static/style.css --minify --outfile=dist/style.css
cp static/sw.js dist/sw.js

sed "s/__BUILD__/$BUILD/g" static/index.html > dist/index.src.html
html-minifier-terser --collapse-whitespace --remove-comments -o dist/index.html dist/index.src.html
rm dist/index.src.html
