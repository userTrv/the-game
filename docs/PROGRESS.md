# Прогресс

Живой журнал: что готово, что в работе, что дальше. Обновляется после каждого этапа.
Работа идёт в ветке `feat/initial-game`. Субагентов не запускать (решение владельца: расход лимитов).

## Готово
- Каркас pnpm-монорепо, TypeScript strict, ESLint, Prettier, политика зависимостей (7 дней, без install-скриптов).
- `packages/shared`: данные (6 рационов, 38 существ, 44 жильца, 24 мутации, 14 раковин, 3 героя, 4 стража),
  детерминированный автобой (`battle.ts`), редьюсер забега (`run.ts`), предложения по генам (`offers.ts`),
  мета (`meta.ts`: городок, таланты, садок, альманах), live-ops (`liveops.ts`: задания, событие, Кракен,
  лиги, товары за Stars, реклама). 30 unit-тестов.
- `apps/bot` (grammY: /start, /paysupport, /terms, настройки, платежи Stars, очередь рассылок) и
  `tools/mock-telegram` (мок Bot API с управляющим API). Тесты зелёные.
- `apps/client/src/audio`: процедурный звук и музыка (Web Audio), тесты зелёные.
- Контракты: `docs/API.md` (публичный API), `docs/INTERNAL_API.md` (сервер ↔ бот).

## В работе
- `apps/server`: ядро (авторизация, забеги, городок, live-ops). Файл `packages/shared/src/api.ts` пока пустой.

## Дальше (по порядку)
1. Сервер: ядро → платежи, реклама, inbox, очередь рассылок, админ-API.
2. Арт-пайплайн `tools/art` (SVG кодом → атласы), `docs/ART.md`, страница-превью.
3. Клиент: загрузка, заводь (Pixi), привал, автобой, итоги, городок, магазин, live-ops экраны, i18n ru/en.
4. Мок `window.Telegram.WebApp`, `tools/dev/dev.mjs` (запуск всего одной командой).
5. Админка `apps/admin`, лендинг, PWA.
6. Баланс-симулятор `tools/balance`, `docs/BALANCE.md`.
7. Инфраструктура: Dockerfile, compose, Caddyfile, CI, `.env.example`.
8. e2e Playwright, визуальный проход, GDD/DECISIONS/lessons/SETUP/REPORT, независимое ревью, PR.
