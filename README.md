# Shellter

Спокойная мобильная игра про рака-отшельника: ешь, расти и собирай риф на собственной раковине. Работает как
Telegram Mini App, как обычный сайт и в Яндекс Играх (без сервера, см. [docs/YANDEX.md](docs/YANDEX.md)).

- Дизайн игры: [docs/GDD.md](docs/GDD.md)
- Что готово и что проверено: [docs/REPORT.md](docs/REPORT.md)
- Настройка настоящих сервисов: [docs/SETUP.md](docs/SETUP.md)

## Запуск

Нужны Node.js 22+ и pnpm 10 (`corepack enable`). Docker и Postgres для разработки не нужны.

```bash
pnpm install --frozen-lockfile
pnpm art     # сгенерировать спрайты (один раз и после правок в tools/art)
pnpm dev     # сервер, мок Telegram, бот и клиент
```

| Адрес | Что там |
|---|---|
| http://localhost:5173/ | Сайт, вход гостем |
| http://localhost:5173/?mock=tg | Игра как в Telegram, с моком `Telegram.WebApp` |
| http://localhost:5173/?mock=tg&tglang=en&tgid=42 | То же с другим языком и пользователем |
| http://localhost:3000/admin/api | API админки, пароль `admin` |

В разработке всё работает на моках: база PGlite в папке `.pglite`, мок Telegram Bot API, реклама
«показывается» за полсекунды. Настоящие токены не нужны. Покупок за деньги в игре нет.

Админка в разработке: `pnpm --filter @shellter/admin dev`, затем http://localhost:5174/admin/.

## Проверки

```bash
pnpm check     # типы, линт, unit-тесты, сборка
pnpm e2e       # Playwright, экран 390×844: первая сессия целиком и реклама на моках
pnpm balance   # симулятор баланса, см. docs/BALANCE.md
```

`pnpm e2e` сам поднимает всё нужное. Вне среды с предустановленным браузером сначала выполнить
`pnpm --filter @shellter/client exec playwright install chromium`.

## Устройство репозитория

| Папка | Что в ней |
|---|---|
| `packages/shared` | Данные игры, редьюсер забега, автобой, мета, live-ops, схемы API. Общий код сервера и клиента |
| `apps/server` | Сервер на Fastify и Postgres: авторизация, забеги, городок, события, реклама, рассылки, API админки |
| `apps/client` | Клиент: Preact для интерфейса, PixiJS для заводи и боя |
| `apps/bot` | Бот на grammY: команды и рассылки |
| `apps/admin` | Админка |
| `tools/art` | Спрайты кодом и запекание в атласы |
| `tools/balance` | Симулятор баланса |
| `tools/mock-telegram` | Мок Telegram Bot API для разработки и тестов |
| `tools/yandex` | Проверка и упаковка архива для Яндекс Игр, иконка и обложка для консоли |
| `tools/dev` | Запуск всего одной командой |
| `deploy` | Пример Caddyfile |
| `docs` | Документация |

## Выкладка

```bash
cp .env.example .env    # заполнить по docs/SETUP.md
mkdir -p secrets && openssl rand -base64 32 > secrets/pg_password.txt
docker compose build
docker compose up -d postgres server
docker compose --profile bot up -d bot
```

Сервер слушает `127.0.0.1:3000` и сам раздаёт клиент и админку. Наружу его выводит обратный прокси, пример —
`deploy/Caddyfile.example`. Бота можно запустить на другом сервере, подробности в
[docs/SETUP.md](docs/SETUP.md).

## Документация

| Файл | О чём |
|---|---|
| [docs/GDD.md](docs/GDD.md) | Дизайн игры |
| [docs/BALANCE.md](docs/BALANCE.md) | Баланс и результаты симулятора |
| [docs/ART.md](docs/ART.md) | Как сделан арт и как добавить спрайт |
| [docs/API.md](docs/API.md) | Публичный API сервера |
| [docs/INTERNAL_API.md](docs/INTERNAL_API.md) | Обмен между сервером и ботом |
| [docs/SETUP.md](docs/SETUP.md) | Что настроить руками перед запуском |
| [docs/YANDEX.md](docs/YANDEX.md) | Сборка для Яндекс Игр, требования, места для рекламы |
| [docs/YANDEX-CONSOLE.md](docs/YANDEX-CONSOLE.md) | Тексты, иконка и обложка для консоли Яндекс Игр |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Принятые решения и причины |
| [docs/REPORT.md](docs/REPORT.md) | Итоговый отчёт |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Журнал прогресса |
| [docs/lessons.md](docs/lessons.md) | Уроки |

## Правила

- Зависимости ставятся только версий старше 7 дней; pnpm проверяет это сам (`pnpm-workspace.yaml`).
- Секреты живут только в `.env` и `secrets/`, обе записи в `.gitignore`.
- GitHub Actions закреплены по SHA, Docker-образы — по digest.
