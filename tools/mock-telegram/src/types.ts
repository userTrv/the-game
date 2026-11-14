/** Public types of the mock Telegram Bot API server. */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** The `from` object accepted by the control API (a Telegram user without `is_bot`). */
export interface ControlUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private';
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TgSuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  entities?: TgMessageEntity[];
  reply_markup?: unknown;
  successful_payment?: TgSuccessfulPayment;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  chat_instance: string;
  data?: string;
  message?: TgMessage;
}

export interface TgPreCheckoutQuery {
  id: string;
  from: TgUser;
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  pre_checkout_query?: TgPreCheckoutQuery;
}

/** A message the bot sent through `sendMessage` (and possibly edited or deleted later). */
export interface SentMessage {
  message_id: number;
  chat_id: number;
  date: number;
  text: string;
  parse_mode?: string;
  reply_markup?: unknown;
  /** Number of successful `editMessageText` / `editMessageReplyMarkup` calls. */
  edits: number;
  deleted: boolean;
}

/** Every `sendMessage` call, including the rejected ones (useful for throttling assertions). */
export interface SendAttempt {
  chat_id: number;
  /** Milliseconds since the Unix epoch. */
  at: number;
  ok: boolean;
  error_code?: number;
}

export interface Invoice {
  id: string;
  url: string;
  title: string;
  description: string;
  payload: string;
  currency: 'XTR';
  /** Price in Telegram Stars. */
  amount: number;
  created_at: number;
}

export type CheckoutStatus = 'pending' | 'approved' | 'rejected' | 'timeout';

export interface Checkout {
  /** `pre_checkout_query.id` */
  id: string;
  invoice_id: string;
  user_id: number;
  status: CheckoutStatus;
  error_message?: string;
}

export interface Payment {
  charge_id: string;
  provider_charge_id: string;
  invoice_id: string;
  user_id: number;
  currency: 'XTR';
  amount: number;
  payload: string;
  paid_at: number;
  refunded: boolean;
  /** How many times the `successful_payment` update was delivered (1 + redeliveries). */
  deliveries: number;
}

export interface Refund {
  charge_id: string;
  user_id: number;
  amount: number;
  refunded_at: number;
}

export interface CallbackAnswer {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export interface CommandsRecord {
  scope: unknown;
  language_code: string;
  commands: { command: string; description: string }[];
}

export interface MenuButtonRecord {
  /** `null` is the default menu button (no `chat_id`). */
  chat_id: number | null;
  menu_button: unknown;
}

export interface RateLimitConfig {
  /** The next N `sendMessage` calls answer 429. */
  failNext: number;
  /** `retry_after` (seconds) reported in 429 answers. */
  retryAfter: number;
  /** Answer 429 when more than this many `sendMessage` calls are accepted within one second. `null` = off. */
  maxPerSecond: number | null;
  /** Same, per chat. `null` = off. */
  maxPerChatPerSecond: number | null;
}

export interface FailureRule {
  /** Bot API method the rule applies to (lower-case comparison). */
  method: string;
  /** How many calls are still going to fail. */
  count: number;
  errorCode: number;
  description: string;
}

/** Snapshot returned by `GET /control/state` and `mock.state()`. */
export interface MockState {
  messages: SentMessage[];
  sendAttempts: SendAttempt[];
  invoices: Invoice[];
  checkouts: Checkout[];
  payments: Payment[];
  refunds: Refund[];
  blockedChats: number[];
  callbackAnswers: CallbackAnswer[];
  commands: CommandsRecord[];
  menuButtons: MenuButtonRecord[];
  webhook: { url: string; has_secret_token: boolean } | null;
  rateLimit: RateLimitConfig;
  failures: FailureRule[];
  pendingUpdates: number;
}

export type PayResult =
  | { status: 'paid'; chargeId: string }
  | { status: 'failed'; error: string }
  | { status: 'timeout' };

export interface PayRequest {
  invoiceId?: string;
  url?: string;
  from: ControlUser;
}

export interface MockTelegramOptions {
  /** When set, only this bot token is accepted (anything else answers 401). Default: accept any token. */
  token?: string;
  /** Base URL used in invoice links. Default: the URL the server listens on. */
  publicUrl?: string;
  /** Host to bind to. Default 127.0.0.1. */
  host?: string;
  botId?: number;
  botUsername?: string;
  botName?: string;
  /** How long `/control/pay` waits for `answerPreCheckoutQuery`. Default 10 000 ms (Telegram's limit). */
  preCheckoutTimeoutMs?: number;
  /** Enable Fastify request logging (off by default). */
  logger?: boolean;
}
