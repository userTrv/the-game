# Внутренний HTTP-контракт «сервер ↔ бот»

Бот (`apps/bot`) живёт отдельным процессом и может стоять на зарубежном сервере: только он ходит в
`api.telegram.org`. С игровым сервером (`apps/server`) он общается по HTTP. Каждый запрос в обе стороны несёт
заголовок `x-internal-secret: <INTERNAL_SECRET>`; без него ответ `401`. Все тела — JSON.

## Сервер принимает от бота (`SERVER_INTERNAL_URL`)

| Метод и путь | Тело | Ответ |
| --- | --- | --- |
| `POST /internal/bot/start` | `{ tgUser: { id, first_name, last_name?, username?, language_code? }, startParam?: string }` | `{ ok: true, isNew: boolean, lang: 'ru' \| 'en' }` |
| `POST /internal/bot/notify-settings` | `{ tgId: number, set?: { enabled?: boolean, corf?: boolean, events?: boolean, kraken?: boolean } }` | `{ ok: true, settings: { enabled, corf, events, kraken }, lang }` |
| `POST /internal/payments/pre-checkout` | `{ tgId, payload, currency, totalAmount }` | `{ ok: boolean, error?: string }` — отвечать быстрее 3 с |
| `POST /internal/payments/successful` | `{ tgId, payload, currency, totalAmount, telegramPaymentChargeId, providerPaymentChargeId? }` | `{ ok: true, duplicate: boolean, productTitle?: string }` |
| `POST /internal/outbox/claim` | `{ limit: number }` | `{ messages: OutboxMessage[] }` |
| `POST /internal/outbox/report` | `{ results: { id: string, status: 'sent' \| 'blocked' \| 'retry' \| 'failed', retryAfter?: number, error?: string }[] }` | `{ ok: true }` |

```ts
interface OutboxMessage {
  id: string;            // id записи очереди
  chatId: number;        // Telegram user id
  text: string;          // HTML
  button?: { text: string; kind: 'webapp' | 'url'; url: string };
}
```

`claim` помечает сообщения взятыми в работу на 60 секунд: если бот не отчитался, сообщение вернётся в очередь.
`retry` возвращает сообщение в очередь с задержкой `retryAfter` секунд; `blocked` помечает игрока как
заблокировавшего бота, и ему больше ничего не шлют.

## Бот принимает от сервера (`BOT_INTERNAL_URL`)

| Метод и путь | Тело | Ответ |
| --- | --- | --- |
| `POST /internal/invoice-link` | `{ title, description, payload, amount }` (`amount` в Stars) | `{ url: string }` |
| `POST /internal/refund` | `{ tgId, telegramPaymentChargeId }` | `{ ok: boolean, error?: string }` |
| `GET /health` | — | `{ ok: true }` |

Инвойс создаётся методом Bot API `createInvoiceLink` с `currency: "XTR"`, пустым `provider_token` и одной
позицией в `prices`. `payload` — непрозрачная строка сервера (id заказа), не длиннее 128 байт.
