import { randomBytes } from 'node:crypto';
import { ControlError, TgApiError, badRequest, tooManyRequests } from './errors';
import type { Params } from './params';
import type {
  CallbackAnswer,
  Checkout,
  CommandsRecord,
  ControlUser,
  FailureRule,
  Invoice,
  MenuButtonRecord,
  MockState,
  PayRequest,
  PayResult,
  Payment,
  RateLimitConfig,
  Refund,
  SendAttempt,
  SentMessage,
  TgChat,
  TgMessage,
  TgUpdate,
  TgUser,
} from './types';

const QUERY_EXPIRED = 'query is too old and response timeout expired or query ID is invalid';
const NOT_MODIFIED =
  'message is not modified: specified new message content and reply markup are exactly the same ' +
  'as a current content and reply markup of the message';
const MAX_LONG_POLL_SECONDS = 50;

export interface CoreOptions {
  botId: number;
  botUsername: string;
  botName: string;
  preCheckoutTimeoutMs: number;
}

interface UpdateWaiter {
  limit: number;
  timer: NodeJS.Timeout;
  resolve: (updates: TgUpdate[]) => void;
  reject: (error: Error) => void;
}

interface CheckoutWaiter {
  timer: NodeJS.Timeout;
  resolve: (status: 'approved' | 'rejected' | 'timeout') => void;
}

export interface UpdatePoll {
  promise: Promise<TgUpdate[]>;
  /** Call when the HTTP client went away before the long poll resolved. */
  cancel: () => void;
}

function defaultRateLimit(): RateLimitConfig {
  return { failNext: 0, retryAfter: 1, maxPerSecond: null, maxPerChatPerSecond: null };
}

function randomId(bytes = 8): string {
  return randomBytes(bytes).toString('hex');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Sorts object keys so that two structurally equal JSON values serialize identically. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}

function updateType(update: TgUpdate): string {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

/**
 * The in-memory state and behaviour of the fake Bot API. It knows nothing about HTTP; `server.ts` exposes
 * it through Fastify.
 */
export class MockCore {
  /** Base URL used for invoice links; set by the HTTP layer once the port is known. */
  publicUrl = '';

  private readonly options: CoreOptions;

  // Counters are never reset: a polling bot keeps its `offset` across `/control/reset`.
  private updateSeq = 1000;
  private messageSeq = 0;
  private querySeq = 0;

  private updates: TgUpdate[] = [];
  private allowedUpdates: string[] | null = null;
  private waiter: UpdateWaiter | null = null;

  private messages: SentMessage[] = [];
  private sendAttempts: SendAttempt[] = [];
  private invoices = new Map<string, Invoice>();
  private checkouts = new Map<string, Checkout>();
  private checkoutWaiters = new Map<string, CheckoutWaiter>();
  private payments = new Map<string, Payment>();
  private paymentMessages = new Map<string, TgMessage>();
  private refunds: Refund[] = [];
  private blocked = new Set<number>();
  private callbackQueryIds = new Set<string>();
  private callbackAnswers: CallbackAnswer[] = [];
  private commands: CommandsRecord[] = [];
  private menuButtons: MenuButtonRecord[] = [];
  private webhook: { url: string; has_secret_token: boolean } | null = null;
  private rateLimit: RateLimitConfig = defaultRateLimit();
  private failures: FailureRule[] = [];
  private watchers = new Set<() => void>();

  constructor(options: CoreOptions) {
    this.options = options;
  }

  // ---------------------------------------------------------------------------------------------------
  // State access
  // ---------------------------------------------------------------------------------------------------

  state(): MockState {
    return structuredClone({
      messages: this.messages,
      sendAttempts: this.sendAttempts,
      invoices: [...this.invoices.values()],
      checkouts: [...this.checkouts.values()],
      payments: [...this.payments.values()],
      refunds: this.refunds,
      blockedChats: [...this.blocked],
      callbackAnswers: this.callbackAnswers,
      commands: this.commands,
      menuButtons: this.menuButtons,
      webhook: this.webhook,
      rateLimit: this.rateLimit,
      failures: this.failures,
      pendingUpdates: this.updates.length,
    });
  }

  /** Clears recorded state and failure controls. Id counters keep growing on purpose. */
  reset(): void {
    this.expireCheckouts();
    this.updates = [];
    this.messages = [];
    this.sendAttempts = [];
    this.invoices.clear();
    this.checkouts.clear();
    this.payments.clear();
    this.paymentMessages.clear();
    this.refunds = [];
    this.blocked.clear();
    this.callbackQueryIds.clear();
    this.callbackAnswers = [];
    this.rateLimit = defaultRateLimit();
    this.failures = [];
    this.changed();
  }

  /** Releases everything that is waiting (long polls, pending checkouts) so the server can close. */
  shutdown(): void {
    this.expireCheckouts();
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timer);
      waiter.resolve([]);
    }
  }

  getInvoice(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  /**
   * Resolves as soon as `probe` returns something other than `undefined`/`false`/`null`. The probe is
   * re-evaluated on every state change, so tests need no sleeps.
   */
  waitFor<T>(probe: (state: MockState) => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const check = (): boolean => {
        const value = probe(this.state());
        if (value === undefined || value === null || value === false) return false;
        resolve(value);
        return true;
      };
      if (check()) return;
      const watcher = (): void => {
        if (check()) {
          clearTimeout(timer);
          this.watchers.delete(watcher);
        }
      };
      const timer = setTimeout(() => {
        this.watchers.delete(watcher);
        reject(new Error(`mock-telegram: waitFor timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.watchers.add(watcher);
    });
  }

  // ---------------------------------------------------------------------------------------------------
  // Control operations
  // ---------------------------------------------------------------------------------------------------

  injectMessage(input: { from: ControlUser; text: string }): TgUpdate {
    const from = this.toUser(input.from);
    const command = /^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?/.exec(input.text);
    const message: TgMessage = {
      message_id: ++this.messageSeq,
      date: nowSeconds(),
      chat: this.toChat(from),
      from,
      text: input.text,
      ...(command ? { entities: [{ type: 'bot_command', offset: 0, length: command[0].length }] } : {}),
    };
    return this.enqueue({ message });
  }

  injectCallback(input: { from: ControlUser; data: string; messageId?: number }): TgUpdate {
    const from = this.toUser(input.from);
    const candidates = this.messages.filter((message) => message.chat_id === from.id && !message.deleted);
    const source =
      input.messageId === undefined
        ? candidates.at(-1)
        : candidates.find((message) => message.message_id === input.messageId);
    if (input.messageId !== undefined && !source) {
      throw new ControlError(404, `message ${input.messageId} not found in chat ${from.id}`);
    }
    const id = `cbq_${++this.querySeq}_${randomId(4)}`;
    this.callbackQueryIds.add(id);
    return this.enqueue({
      callback_query: {
        id,
        from,
        chat_instance: String(from.id),
        data: input.data,
        ...(source ? { message: this.toBotMessage(source) } : {}),
      },
    });
  }

  /** Simulates the user confirming the payment of an invoice (see README for the flow). */
  async pay(request: PayRequest): Promise<PayResult> {
    const invoice = this.resolveInvoice(request);
    const from = this.toUser(request.from);
    const queryId = `pcq_${++this.querySeq}_${randomId(4)}`;
    const checkout: Checkout = { id: queryId, invoice_id: invoice.id, user_id: from.id, status: 'pending' };
    this.checkouts.set(queryId, checkout);

    const answered = new Promise<'approved' | 'rejected' | 'timeout'>((resolve) => {
      const timer = setTimeout(() => {
        this.checkoutWaiters.delete(queryId);
        resolve('timeout');
      }, this.options.preCheckoutTimeoutMs);
      this.checkoutWaiters.set(queryId, { timer, resolve });
    });

    this.enqueue({
      pre_checkout_query: {
        id: queryId,
        from,
        currency: invoice.currency,
        total_amount: invoice.amount,
        invoice_payload: invoice.payload,
      },
    });

    const outcome = await answered;
    if (outcome === 'timeout') {
      checkout.status = 'timeout';
      this.changed();
      return { status: 'timeout' };
    }
    if (outcome === 'rejected') {
      return { status: 'failed', error: checkout.error_message ?? 'rejected' };
    }

    const chargeId = `mock_charge_${randomId(12)}`;
    const payment: Payment = {
      charge_id: chargeId,
      provider_charge_id: `${from.id}_${this.payments.size + 1}`,
      invoice_id: invoice.id,
      user_id: from.id,
      currency: invoice.currency,
      amount: invoice.amount,
      payload: invoice.payload,
      paid_at: nowSeconds(),
      refunded: false,
      deliveries: 1,
    };
    this.payments.set(chargeId, payment);
    const message: TgMessage = {
      message_id: ++this.messageSeq,
      date: payment.paid_at,
      chat: this.toChat(from),
      from,
      successful_payment: {
        currency: payment.currency,
        total_amount: payment.amount,
        invoice_payload: payment.payload,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: payment.provider_charge_id,
      },
    };
    this.paymentMessages.set(chargeId, message);
    this.enqueue({ message });
    return { status: 'paid', chargeId };
  }

  /** Delivers the `successful_payment` message of a charge once more (same message, new `update_id`). */
  redeliver(chargeId: string): TgUpdate {
    const payment = this.payments.get(chargeId);
    const message = this.paymentMessages.get(chargeId);
    if (!payment || !message) throw new ControlError(404, `charge ${chargeId} not found`);
    payment.deliveries += 1;
    return this.enqueue({ message: structuredClone(message) });
  }

  setBlocked(chatId: number, blocked: boolean): void {
    if (blocked) this.blocked.add(chatId);
    else this.blocked.delete(chatId);
    this.changed();
  }

  setRateLimit(patch: Partial<RateLimitConfig>): RateLimitConfig {
    this.rateLimit = { ...this.rateLimit, ...patch };
    this.changed();
    return { ...this.rateLimit };
  }

  /** Makes the next `count` calls of `method` fail with the given Bot API error (e.g. a 500). */
  failNext(rule: { method?: string; count: number; errorCode: number; description?: string }): void {
    this.failures.push({
      method: (rule.method ?? 'sendMessage').toLowerCase(),
      count: rule.count,
      errorCode: rule.errorCode,
      description: rule.description ?? (rule.errorCode >= 500 ? 'Internal Server Error' : 'Bad Request: mock failure'),
    });
    this.changed();
  }

  // ---------------------------------------------------------------------------------------------------
  // Bot API
  // ---------------------------------------------------------------------------------------------------

  pollUpdates(params: Params): UpdatePoll {
    const offset = params.num('offset');
    const limit = clamp(Math.trunc(params.num('limit') ?? 100), 1, 100);
    const timeoutSeconds = clamp(params.num('timeout') ?? 0, 0, MAX_LONG_POLL_SECONDS);
    const allowed = params.json('allowed_updates');
    if (Array.isArray(allowed)) {
      const names = allowed.filter((item): item is string => typeof item === 'string');
      this.allowedUpdates = names.length > 0 ? names : null;
    }

    if (offset !== undefined) {
      // A positive offset confirms everything before it; a negative one keeps only the last |offset| updates.
      this.updates =
        offset >= 0 ? this.updates.filter((update) => update.update_id >= offset) : this.updates.slice(offset);
    }

    // Like the real API, a new getUpdates call terminates the one that is still waiting.
    if (this.waiter) {
      const previous = this.waiter;
      this.waiter = null;
      clearTimeout(previous.timer);
      previous.reject(
        new TgApiError(
          409,
          'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
        ),
      );
    }

    this.dropDisallowedUpdates();
    if (this.updates.length > 0 || timeoutSeconds === 0) {
      return { promise: Promise.resolve(this.updates.slice(0, limit)), cancel: () => undefined };
    }

    let resolvePoll: (updates: TgUpdate[]) => void = () => undefined;
    let rejectPoll: (error: Error) => void = () => undefined;
    const promise = new Promise<TgUpdate[]>((resolve, reject) => {
      resolvePoll = resolve;
      rejectPoll = reject;
    });
    const waiter: UpdateWaiter = {
      limit,
      resolve: resolvePoll,
      reject: rejectPoll,
      timer: setTimeout(() => {
        if (this.waiter === waiter) this.waiter = null;
        resolvePoll([]);
      }, timeoutSeconds * 1000),
    };
    this.waiter = waiter;
    return {
      promise,
      cancel: () => {
        if (this.waiter === waiter) this.waiter = null;
        clearTimeout(waiter.timer);
        resolvePoll([]);
      },
    };
  }

  /** Executes any Bot API method except `getUpdates`. Throws `TgApiError` for API-level failures. */
  call(method: string, params: Params): unknown {
    const name = method.toLowerCase();
    // sendMessage applies its failure rules itself so that the failed attempt is recorded with its chat.
    if (name !== 'sendmessage') this.applyFailureRule(name);
    switch (name) {
      case 'getme':
        return this.botUser(true);
      case 'setwebhook':
        this.webhook = { url: params.requireStr('url'), has_secret_token: params.has('secret_token') };
        this.changed();
        return true;
      case 'deletewebhook':
        this.webhook = null;
        this.changed();
        return true;
      case 'getwebhookinfo':
        return {
          url: this.webhook?.url ?? '',
          has_custom_certificate: false,
          pending_update_count: this.updates.length,
        };
      case 'sendmessage':
        return this.sendMessage(params);
      case 'editmessagetext':
        return this.editMessage(params, true);
      case 'editmessagereplymarkup':
        return this.editMessage(params, false);
      case 'deletemessage':
        return this.deleteMessage(params);
      case 'setmycommands':
        return this.setMyCommands(params);
      case 'getmycommands':
        return this.findCommands(params)?.commands ?? [];
      case 'deletemycommands': {
        const existing = this.findCommands(params);
        this.commands = this.commands.filter((record) => record !== existing);
        this.changed();
        return true;
      }
      case 'setchatmenubutton':
        return this.setChatMenuButton(params);
      case 'getchatmenubutton': {
        const chatId = params.num('chat_id') ?? null;
        const record =
          this.menuButtons.find((item) => item.chat_id === chatId) ??
          this.menuButtons.find((item) => item.chat_id === null);
        return record?.menu_button ?? { type: 'default' };
      }
      case 'answercallbackquery':
        return this.answerCallbackQuery(params);
      case 'createinvoicelink':
        return this.createInvoiceLink(params);
      case 'answerprecheckoutquery':
        return this.answerPreCheckoutQuery(params);
      case 'refundstarpayment':
        return this.refundStarPayment(params);
      case 'getstartransactions':
        return this.getStarTransactions(params);
      default:
        throw new TgApiError(404, 'Not Found: method not found');
    }
  }

  private sendMessage(params: Params): TgMessage {
    const chatId = params.num('chat_id');
    if (chatId === undefined) throw badRequest('chat not found');
    const text = params.str('text') ?? '';
    const attempt: SendAttempt = { chat_id: chatId, at: Date.now(), ok: false };
    this.sendAttempts.push(attempt);
    try {
      this.applyFailureRule('sendmessage');
      this.checkSendLimits(chatId, attempt.at);
      if (this.blocked.has(chatId)) throw new TgApiError(403, 'Forbidden: bot was blocked by the user');
      if (text.length === 0) throw badRequest('message text is empty');
      if (text.length > 4096) throw badRequest('message is too long');
      const replyMarkup = this.readReplyMarkup(params);
      const message: SentMessage = {
        message_id: ++this.messageSeq,
        chat_id: chatId,
        date: nowSeconds(),
        text,
        ...(params.has('parse_mode') ? { parse_mode: params.str('parse_mode') } : {}),
        ...(replyMarkup !== undefined ? { reply_markup: replyMarkup } : {}),
        edits: 0,
        deleted: false,
      };
      this.messages.push(message);
      attempt.ok = true;
      return this.toBotMessage(message);
    } catch (error) {
      if (error instanceof TgApiError) attempt.error_code = error.errorCode;
      throw error;
    } finally {
      this.changed();
    }
  }

  private checkSendLimits(chatId: number, now: number): void {
    const limit = this.rateLimit;
    if (limit.failNext > 0) {
      limit.failNext -= 1;
      throw tooManyRequests(limit.retryAfter);
    }
    if (limit.maxPerSecond === null && limit.maxPerChatPerSecond === null) return;
    const recent = this.sendAttempts.filter((attempt) => attempt.ok && now - attempt.at < 1000);
    if (limit.maxPerSecond !== null && recent.length >= limit.maxPerSecond) {
      throw tooManyRequests(limit.retryAfter);
    }
    if (
      limit.maxPerChatPerSecond !== null &&
      recent.filter((attempt) => attempt.chat_id === chatId).length >= limit.maxPerChatPerSecond
    ) {
      throw tooManyRequests(limit.retryAfter);
    }
  }

  private editMessage(params: Params, withText: boolean): TgMessage {
    const chatId = params.num('chat_id');
    const messageId = params.num('message_id');
    const message = this.messages.find(
      (item) => item.chat_id === chatId && item.message_id === messageId && !item.deleted,
    );
    if (!message) throw badRequest('message to edit not found');
    const text = withText ? (params.str('text') ?? '') : message.text;
    if (text.length === 0) throw badRequest('message text is empty');
    // Like the real API: an edit without reply_markup removes the inline keyboard.
    const replyMarkup = this.readReplyMarkup(params);
    if (text === message.text && stableJson(replyMarkup ?? null) === stableJson(message.reply_markup ?? null)) {
      throw badRequest(NOT_MODIFIED);
    }
    message.text = text;
    if (withText) {
      if (params.has('parse_mode')) message.parse_mode = params.str('parse_mode');
      else delete message.parse_mode;
    }
    if (replyMarkup === undefined) delete message.reply_markup;
    else message.reply_markup = replyMarkup;
    message.edits += 1;
    this.changed();
    return this.toBotMessage(message);
  }

  private deleteMessage(params: Params): true {
    const chatId = params.num('chat_id');
    const messageId = params.num('message_id');
    const message = this.messages.find(
      (item) => item.chat_id === chatId && item.message_id === messageId && !item.deleted,
    );
    if (!message) throw badRequest('message to delete not found');
    message.deleted = true;
    this.changed();
    return true;
  }

  private readReplyMarkup(params: Params): unknown {
    const markup = params.json('reply_markup');
    if (markup === undefined) return undefined;
    if (!isRecord(markup)) throw badRequest("can't parse reply keyboard markup JSON object");
    return markup;
  }

  private setMyCommands(params: Params): true {
    const raw = params.json('commands');
    if (!Array.isArray(raw)) throw badRequest('parameter "commands" is required');
    const commands = raw.map((item) => {
      const command = isRecord(item) ? item.command : undefined;
      const description = isRecord(item) ? item.description : undefined;
      if (typeof command !== 'string' || !/^[a-z0-9_]{1,32}$/.test(command)) throw badRequest('BOT_COMMAND_INVALID');
      if (typeof description !== 'string' || description.length < 1 || description.length > 256) {
        throw badRequest('BOT_COMMAND_DESCRIPTION_INVALID');
      }
      return { command, description };
    });
    const existing = this.findCommands(params);
    this.commands = this.commands.filter((record) => record !== existing);
    this.commands.push({
      scope: params.json('scope') ?? { type: 'default' },
      language_code: params.str('language_code') ?? '',
      commands,
    });
    this.changed();
    return true;
  }

  private findCommands(params: Params): CommandsRecord | undefined {
    const scope = stableJson(params.json('scope') ?? { type: 'default' });
    const languageCode = params.str('language_code') ?? '';
    return this.commands.find(
      (record) => stableJson(record.scope) === scope && record.language_code === languageCode,
    );
  }

  private setChatMenuButton(params: Params): true {
    const chatId = params.num('chat_id') ?? null;
    const menuButton = params.json('menu_button') ?? { type: 'default' };
    if (!isRecord(menuButton)) throw badRequest("can't parse menu button JSON object");
    this.menuButtons = this.menuButtons.filter((record) => record.chat_id !== chatId);
    this.menuButtons.push({ chat_id: chatId, menu_button: menuButton });
    this.changed();
    return true;
  }

  private answerCallbackQuery(params: Params): true {
    const id = params.requireStr('callback_query_id');
    if (!this.callbackQueryIds.has(id)) throw badRequest(QUERY_EXPIRED);
    const text = params.str('text');
    const showAlert = params.bool('show_alert');
    this.callbackAnswers.push({
      callback_query_id: id,
      ...(text !== undefined ? { text } : {}),
      ...(showAlert !== undefined ? { show_alert: showAlert } : {}),
    });
    this.changed();
    return true;
  }

  private createInvoiceLink(params: Params): string {
    const title = params.str('title') ?? '';
    const description = params.str('description') ?? '';
    const payload = params.str('payload') ?? '';
    if (title.length < 1 || title.length > 32) throw badRequest('INVOICE_TITLE_INVALID: title must be 1-32 characters');
    if (description.length < 1 || description.length > 255) {
      throw badRequest('INVOICE_DESCRIPTION_INVALID: description must be 1-255 characters');
    }
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    if (payloadBytes < 1 || payloadBytes > 128) throw badRequest('INVOICE_PAYLOAD_INVALID: payload must be 1-128 bytes');
    if (params.str('currency') !== 'XTR') throw badRequest('CURRENCY_INVALID: the mock only supports XTR (Telegram Stars)');
    if ((params.str('provider_token') ?? '') !== '') {
      throw badRequest('provider_token must be empty for payments in Telegram Stars');
    }
    const prices = params.json('prices');
    if (!Array.isArray(prices) || prices.length !== 1) {
      throw badRequest('STARS_INVOICE_INVALID: exactly one price is required for payments in Telegram Stars');
    }
    const price: unknown = prices[0];
    const amount = isRecord(price) ? price.amount : undefined;
    const label = isRecord(price) ? price.label : undefined;
    if (typeof label !== 'string' || label.length === 0) throw badRequest('INVOICE_PRICE_LABEL_INVALID');
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
      throw badRequest('INVOICE_AMOUNT_INVALID: amount must be a positive integer number of Stars');
    }

    const id = randomId(8);
    const invoice: Invoice = {
      id,
      url: `${this.publicUrl}/invoice/${id}`,
      title,
      description,
      payload,
      currency: 'XTR',
      amount,
      created_at: nowSeconds(),
    };
    this.invoices.set(id, invoice);
    this.changed();
    return invoice.url;
  }

  private answerPreCheckoutQuery(params: Params): true {
    const id = params.requireStr('pre_checkout_query_id');
    const ok = params.bool('ok');
    if (ok === undefined) throw badRequest('parameter "ok" is required');
    const checkout = this.checkouts.get(id);
    const waiter = this.checkoutWaiters.get(id);
    if (!checkout || !waiter || checkout.status !== 'pending') throw badRequest(QUERY_EXPIRED);
    const errorMessage = params.str('error_message');
    if (!ok && (errorMessage === undefined || errorMessage.length === 0)) {
      throw badRequest('error_message is required if ok is false');
    }
    clearTimeout(waiter.timer);
    this.checkoutWaiters.delete(id);
    checkout.status = ok ? 'approved' : 'rejected';
    if (!ok) checkout.error_message = errorMessage;
    waiter.resolve(checkout.status);
    this.changed();
    return true;
  }

  private refundStarPayment(params: Params): true {
    const userId = params.requireNum('user_id');
    const chargeId = params.requireStr('telegram_payment_charge_id');
    const payment = this.payments.get(chargeId);
    if (!payment || payment.user_id !== userId) throw badRequest('CHARGE_NOT_FOUND');
    if (payment.refunded) throw badRequest('CHARGE_ALREADY_REFUNDED');
    payment.refunded = true;
    this.refunds.push({ charge_id: chargeId, user_id: userId, amount: payment.amount, refunded_at: nowSeconds() });
    this.changed();
    return true;
  }

  private getStarTransactions(params: Params): { transactions: unknown[] } {
    const offset = Math.max(0, Math.trunc(params.num('offset') ?? 0));
    const limit = clamp(Math.trunc(params.num('limit') ?? 100), 1, 100);
    const incoming = [...this.payments.values()].map((payment) => ({
      id: payment.charge_id,
      amount: payment.amount,
      date: payment.paid_at,
      source: {
        type: 'user',
        transaction_type: 'invoice_payment',
        user: { id: payment.user_id, is_bot: false, first_name: 'User' },
        invoice_payload: payment.payload,
      },
    }));
    const outgoing = this.refunds.map((refund) => ({
      id: refund.charge_id,
      amount: refund.amount,
      date: refund.refunded_at,
      receiver: {
        type: 'user',
        transaction_type: 'invoice_payment',
        user: { id: refund.user_id, is_bot: false, first_name: 'User' },
      },
    }));
    const transactions = [...incoming, ...outgoing].sort((a, b) => a.date - b.date);
    return { transactions: transactions.slice(offset, offset + limit) };
  }

  // ---------------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------------

  private applyFailureRule(method: string): void {
    const rule = this.failures.find((item) => item.method === method && item.count > 0);
    if (!rule) return;
    rule.count -= 1;
    if (rule.count === 0) this.failures = this.failures.filter((item) => item !== rule);
    this.changed();
    throw new TgApiError(rule.errorCode, rule.description);
  }

  private enqueue(partial: Omit<TgUpdate, 'update_id'>): TgUpdate {
    const update: TgUpdate = { update_id: ++this.updateSeq, ...partial };
    this.updates.push(update);
    this.deliverToWaiter();
    this.changed();
    return update;
  }

  private deliverToWaiter(): void {
    if (!this.waiter) return;
    this.dropDisallowedUpdates();
    if (this.updates.length === 0) return;
    const waiter = this.waiter;
    this.waiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(this.updates.slice(0, waiter.limit));
  }

  /** Telegram never delivers update types missing from `allowed_updates`; neither does the mock. */
  private dropDisallowedUpdates(): void {
    const allowed = this.allowedUpdates;
    if (allowed === null) return;
    this.updates = this.updates.filter((update) => allowed.includes(updateType(update)));
  }

  private expireCheckouts(): void {
    for (const [id, waiter] of this.checkoutWaiters) {
      clearTimeout(waiter.timer);
      const checkout = this.checkouts.get(id);
      if (checkout) checkout.status = 'timeout';
      waiter.resolve('timeout');
    }
    this.checkoutWaiters.clear();
  }

  private resolveInvoice(request: PayRequest): Invoice {
    let invoice: Invoice | undefined;
    if (request.invoiceId !== undefined) {
      invoice = this.invoices.get(request.invoiceId);
    } else if (request.url !== undefined) {
      const url = request.url;
      invoice =
        [...this.invoices.values()].find((item) => item.url === url) ??
        this.invoices.get(url.split(/[?#]/)[0]?.split('/').filter(Boolean).at(-1) ?? '');
    } else {
      throw new ControlError(400, 'either invoiceId or url is required');
    }
    if (!invoice) throw new ControlError(404, 'invoice not found');
    return invoice;
  }

  private changed(): void {
    for (const watcher of [...this.watchers]) watcher();
  }

  private botUser(full = false): TgUser & Record<string, unknown> {
    return {
      id: this.options.botId,
      is_bot: true,
      first_name: this.options.botName,
      username: this.options.botUsername,
      ...(full
        ? {
            can_join_groups: true,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
            can_connect_to_business: false,
            has_main_web_app: false,
          }
        : {}),
    };
  }

  private toUser(from: ControlUser): TgUser {
    return {
      id: from.id,
      is_bot: false,
      first_name: from.first_name ?? `User${from.id}`,
      ...(from.last_name !== undefined ? { last_name: from.last_name } : {}),
      ...(from.username !== undefined ? { username: from.username } : {}),
      ...(from.language_code !== undefined ? { language_code: from.language_code } : {}),
    };
  }

  private toChat(user: TgUser): TgChat {
    return {
      id: user.id,
      type: 'private',
      first_name: user.first_name,
      ...(user.last_name !== undefined ? { last_name: user.last_name } : {}),
      ...(user.username !== undefined ? { username: user.username } : {}),
    };
  }

  private toBotMessage(message: SentMessage): TgMessage {
    return {
      message_id: message.message_id,
      date: message.date,
      chat: { id: message.chat_id, type: 'private' },
      from: this.botUser(),
      text: message.text,
      ...(message.reply_markup !== undefined ? { reply_markup: message.reply_markup } : {}),
    };
  }
}
