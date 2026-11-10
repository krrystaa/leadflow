# LEADFLOW — публикация оригинального сайта на Railway

## Важно
Папка `site/` скопирована из оригинального архива. Файлы HTML, CSS, JS и `_headers` не редактировались.
`server.js` и `package.json` — только минимальная обвязка для запуска статического сайта на Railway.
`database/verify_readonly.sql` не загружается в публичный репозиторий.

## GitHub
Загрузи содержимое этой папки в корень приватного GitHub-репозитория.
В корне репозитория должны лежать `package.json`, `server.js`, `.gitignore` и папка `site/`.

## Railway
New Project → Deploy from GitHub Repo → выбрать репозиторий.
Команда запуска: `npm start`.
После деплоя: Settings → Networking → Generate Domain.

## CRM
Адрес кабинета: `https://ТВОЙ-ДОМЕН/crm.html`.
В Supabase Authentication → URL Configuration установи Site URL в `https://ТВОЙ-ДОМЕН`,
а Redirect URLs добавь `https://ТВОЙ-ДОМЕН/crm.html`.

Для входа используй email, который уже разрешён как администратор CRM в Supabase.
