#!/bin/sh
# Собирает сайт для GitHub Pages в dist/ из уже собранных клиентов
# (сначала yarn build):
#
#   dist/           страница книги (web/book), она же витрина проекта
#   dist/phone/     приложение телефона (web/phone)
#   dist/site/      витрина: её подгружает страница книги в современных браузерах
set -eu
cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist
cp -R book/dist/. dist/
cp -R phone/dist dist/phone
cp -R site/dist dist/site
# Без этого GitHub Pages прогнал бы файлы через Jekyll.
touch dist/.nojekyll

# Заранее сжатые копии не нужны: GitHub Pages сжимает ответы сам.
find dist -name '*.gz' -delete
ls -R dist
