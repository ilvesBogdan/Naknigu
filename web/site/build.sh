#!/bin/sh
# Сборка витрины проекта в dist/: showcase.js, showcase.css и словари
# locales/ru.json и locales/en.json. Их подгружает страница книги
# (web/book/src/showcase.ts), и только в современных браузерах; из словарей
# витрина скачивает только словарь выбранного языка.
#
#   GITHUB_REPOSITORY=владелец/имя sh build.sh
#
# GITHUB_REPOSITORY (на GitHub Actions он задан всегда) — откуда брать адрес
# репозитория для ссылок на исходный код.
set -eu
cd "$(dirname "$0")"

REPO=${GITHUB_REPOSITORY:-ilvesBogdan/naknigu}
if ! printf '%s' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
    echo "GITHUB_REPOSITORY must look like owner/name" >&2
    exit 1
fi

# Витрину получают только браузеры с :has(), контейнерными запросами
# и oklch(): Chrome и Edge 111+, Firefox 121+, Safari 16.4+.
TARGET=chrome111,edge111,firefox121,safari16.4

# Номер сборки словарей — их контрольная сумма: витрина добавляет его
# к адресу словаря, и браузер не возьмёт из кэша старую версию.
LOCALES=$(cat locales/*.json | cksum | cut -d' ' -f1)

esbuild src/showcase.ts --bundle --minify --charset=utf8 --format=esm --target=$TARGET \
    --loader:.html=text --define:__REPO__="\"$REPO\"" --define:__LOCALES__="\"$LOCALES\"" \
    --outfile=dist/showcase.js
esbuild src/showcase.css --minify --target=$TARGET --outfile=dist/showcase.css

# Словари — без пробелов и переносов строк: JSON.parse и обратно.
rm -rf dist/locales
mkdir -p dist/locales
for file in locales/*.json; do
    node -e 'const fs = require("fs"); fs.writeFileSync(process.argv[2], JSON.stringify(JSON.parse(fs.readFileSync(process.argv[1], "utf8"))));' \
        "$file" "dist/$file"
done
