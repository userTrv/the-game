# Публичный HTTP API (`/api/*`)

Сервер — источник правды. Клиент присылает действия, сервер считает результат по игровым данным из
`packages/shared` и возвращает новое состояние. Схемы запросов (zod) и типы ответов лежат в
`packages/shared/src/api.ts`: клиент и сервер импортируют их оттуда.

Общее:

- Авторизация: `Authorization: Bearer <JWT>`; JWT выдают эндпоинты `/api/auth/*`.
- Ошибка: HTTP 4xx/5xx и тело `{ "error": { "code": "snake_case", "message": "..." } }`.
  Коды игровых правил совпадают с `RunError.code` и `MetaError.code` из shared.
- Все числа валюты целые. Время — Unix ms.

## Типы

```ts
interface PlayerView {
  id: string;
  name: string;
  lang: 'ru' | 'en';
  guest: boolean;            // true, пока аккаунт не привязан к Telegram
  profile: Profile;          // shared/meta.ts
  quests: QuestState;        // shared/liveops.ts (уже обновлены на текущий день и неделю)
  cosmetics: { owned: string[]; equipped: Record<CosmeticKind, string> };
  pass: { season: string; xp: number; premium: boolean; claimedFree: number[]; claimedPremium: number[] };
  perks: { noAds: boolean; secondChanceTokens: number; saveSlots: number };
  corf: { amount: number; cap: number; full: boolean };
  league: LeagueId;
  inboxUnread: number;
  serverTime: number;
}

interface RunEnded {            // приходит, когда забег завершился этим действием
  result: 'carried' | 'defeat' | 'cleared';
  summary: RunSummary;          // shared/meta.ts
  questsCompleted: string[];    // id заданий, которые этим забегом выполнены (ещё не получены)
  eventScore?: number;
}
```

## Эндпоинты

| Метод и путь | Тело | Ответ |
| --- | --- | --- |
| `POST /api/auth/telegram` | `{ initData: string }` | `{ token, player, run }` |
| `POST /api/auth/guest` | `{ secret?: string }` | `{ token, secret, player, run }` |
| `POST /api/auth/widget` | данные Telegram Login Widget | `{ token, player, run }` |
| `POST /api/auth/link` | `{ initData }` (гость привязывает Telegram) | `{ token, player, run }` |
| `GET /api/me` | — | `{ player, run, liveops }` |
| `POST /api/me/settings` | `{ lang?, name? }` | `{ player }` |
| `POST /api/run/start` | `{ heroId, slot?: number }` | `{ run, player }` |
| `POST /api/run/action` | `{ runId, seq, action }` | `{ run, events, player?, ended? }` |
| `POST /api/run/abandon` | `{ runId }` | `{ run, player, ended }` |
| `POST /api/town/upgrade` | `{ building }` | `{ player }` |
| `POST /api/town/talent` | `{ id }` | `{ player }` |
| `POST /api/town/hero` | `{ heroId }` | `{ player }` |
| `POST /api/corf/collect` | `{ adIntentId?: string }` | `{ player, gained }` |
| `POST /api/almanac/claim` | `{ id }` | `{ player, reward }` |
| `POST /api/quests/claim` | `{ id }` | `{ player, reward }` |
| `POST /api/pass/claim` | `{ level, track: 'free' \| 'premium' }` | `{ player }` |
| `POST /api/cosmetics/equip` | `{ id }` | `{ player }` |
| `GET /api/liveops` | — | `LiveopsView` |
| `POST /api/kraken/attack` | — | `{ damage, seed, build, kraken, player }` |
| `POST /api/kraken/claim` | `{ pct }` | `{ player, reward }` |
| `POST /api/analytics` | `{ sessionId, events: { type, props?, t }[] }` | `{ ok: true }` |
| `GET /health`, `GET /ready` | — | `{ ok: true }` |

`run` — это `PublicRun` из shared (без seed) или `null`, если активного забега нет.

### `POST /api/run/action`

`action` — клиентское подмножество `RunAction` из shared:

- `hunt_done { report }`, `pick_offer { index, slot? }`, `skip_offer`, `buy { index, slot? }`,
  `sell { slot }`, `move { from, to }`, `choose_shell { index }`, `descend`, `carry_out`, `battle`, `give_up`;
- `reroll { adIntentId? }` — бесплатный реролл только с подтверждённым сервером рекламным интентом;
- `second_chance { adIntentId? }` — тратит жетон второго шанса или подтверждённый рекламный интент.

`seq` защищает от повторной отправки: сервер хранит номер последнего применённого действия забега.
Запрос с `seq = last + 1` применяется; с `seq = last` возвращается сохранённый прошлый ответ (повтор после
обрыва сети); любой другой номер — ошибка `bad_seq`.

Для `hunt_done` сервер сам передаёт в редьюсер время, прошедшее с начала заводи, и режет отчёт до
физических пределов заводи (`huntCaps`). Срезанное пишется в аналитику как `suspicious`.

Призрак для стража подбирает сервер на `descend`: глубина та же, сила в пределах 0,75–1,2 от силы игрока.
