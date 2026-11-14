import { COSMETIC_BY_ID, dayKey, PRODUCT_BY_ID, PRODUCTS, type OrderView, type ProductDef, type ShopView } from '@shellter/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import { randomId } from './auth';
import { addInbox, ApiFail, lockPlayer, savePlayer, track, type BotClient, type Ctx, type PlayerRow } from './core';
import type { Db, Tx } from './db';
import { payments, players } from './db/schema';

const TITLES: Record<string, { ru: string; en: string }> = {
  crab_azure: { ru: 'Окрас «Лазурь»', en: 'Azure crab colours' },
  crab_coral: { ru: 'Окрас «Коралл»', en: 'Coral crab colours' },
  shell_candy: { ru: 'Раскраска раковин «Карамель»', en: 'Candy shell paint' },
  shell_galaxy: { ru: 'Раскраска раковин «Галактика»', en: 'Galaxy shell paint' },
  merge_rainbow: { ru: 'Эффект слияния «Радуга»', en: 'Rainbow merge effect' },
  town_lanterns: { ru: 'Фонарики для городка', en: 'Town lanterns' },
  season_pass: { ru: 'Сезонный пропуск', en: 'Season pass' },
  no_ads: { ru: 'Награды без рекламы', en: 'Rewards without ads' },
  save_slot: { ru: 'Второй слот забега', en: 'Second run slot' },
  second_chance: { ru: 'Второй шанс', en: 'Second chance' },
  pack_coral_s: { ru: 'Горсть кораллов', en: 'Handful of coral' },
  pack_coral_m: { ru: 'Сундучок кораллов', en: 'Chest of coral' },
};

export function productTitle(id: string, lang: string): string {
  const t = TITLES[id];
  return t ? (lang === 'en' ? t.en : t.ru) : id;
}

async function unavailable(q: Tx | Db, now: number, row: PlayerRow, p: ProductDef): Promise<'owned' | 'daily_limit' | null> {
  const g = p.grant;
  if (g.type === 'cosmetic' && row.cosmetics.owned.includes(g.id)) return 'owned';
  if (g.type === 'pass' && row.pass.premium) return 'owned';
  if (g.type === 'no_ads' && row.perks.noAds) return 'owned';
  if (g.type === 'save_slot' && row.perks.saveSlots >= 2) return 'owned';
  if (p.dailyLimit) {
    const dayStart = Date.parse(`${dayKey(now)}T00:00:00Z`);
    const [c] = await q
      .select({ n: sql<number>`count(*)::int` })
      .from(payments)
      .where(and(eq(payments.playerId, row.id), eq(payments.productId, p.id), eq(payments.status, 'paid'), gte(payments.paidAt, dayStart)));
    if ((c?.n ?? 0) >= p.dailyLimit) return 'daily_limit';
  }
  return null;
}

export async function shopView(ctx: Ctx, row: PlayerRow): Promise<ShopView> {
  const now = ctx.now();
  const products: ShopView['products'] = [];
  for (const p of PRODUCTS) {
    const reason = await unavailable(ctx.db, now, row, p);
    products.push(reason ? { id: p.id, stars: p.stars, available: false, reason } : { id: p.id, stars: p.stars, available: true });
  }
  return { products, enabled: ctx.bot !== null };
}

export async function createInvoice(ctx: Ctx, playerId: string, productId: string): Promise<{ orderId: string; url: string }> {
  const now = ctx.now();
  const product = PRODUCT_BY_ID.get(productId);
  if (!product) throw new ApiFail('product_unknown');
  if (!ctx.bot) throw new ApiFail('shop_disabled', 503);
  const [row] = await ctx.db.select().from(players).where(eq(players.id, playerId));
  if (!row) throw new ApiFail('unauthorized', 401);
  const reason = await unavailable(ctx.db, now, row, product);
  if (reason) throw new ApiFail(`product_${reason}`);
  const orderId = randomId(15);
  await ctx.db.insert(payments).values({ id: orderId, playerId, productId, stars: product.stars, status: 'pending', createdAt: now });
  let url: string;
  try {
    url = await ctx.bot.invoiceLink({
      title: productTitle(productId, row.lang),
      description: row.lang === 'en' ? 'A purchase in Shellter. Delivered instantly.' : 'Покупка в игре Shellter. Выдаётся сразу после оплаты.',
      payload: orderId,
      amount: product.stars,
    });
  } catch {
    throw new ApiFail('shop_unavailable', 503);
  }
  await track(ctx.db, now, playerId, 'purchase_invoice', { product: productId, stars: product.stars });
  return { orderId, url };
}

export async function orderView(ctx: Ctx, playerId: string, id: string): Promise<OrderView> {
  const [o] = await ctx.db.select().from(payments).where(and(eq(payments.id, id), eq(payments.playerId, playerId)));
  if (!o) throw new ApiFail('order_not_found', 404);
  return { id: o.id, productId: o.productId, status: o.status };
}

/** Telegram asks before charging: the order must exist, be unpaid and match the price. */
export async function preCheckout(ctx: Ctx, input: { payload: string; currency: string; totalAmount: number }): Promise<{ ok: boolean; error?: string }> {
  const [o] = await ctx.db.select().from(payments).where(eq(payments.id, input.payload));
  const product = o ? PRODUCT_BY_ID.get(o.productId) : undefined;
  if (!o || !product) return { ok: false, error: 'Заказ не найден. Order not found.' };
  if (o.status !== 'pending') return { ok: false, error: 'Заказ уже оплачен. Order is already paid.' };
  if (input.currency !== 'XTR' || input.totalAmount !== product.stars) return { ok: false, error: 'Цена изменилась, открой магазин заново. Price changed, reopen the shop.' };
  const [row] = await ctx.db.select().from(players).where(eq(players.id, o.playerId));
  if (!row) return { ok: false, error: 'Игрок не найден. Player not found.' };
  if (await unavailable(ctx.db, ctx.now(), row, product)) return { ok: false, error: 'Товар уже куплен. Already owned.' };
  return { ok: true };
}

function applyGrant(row: PlayerRow, p: ProductDef, sign: 1 | -1): Record<string, unknown> {
  const g = p.grant;
  switch (g.type) {
    case 'cosmetic': {
      const owned = row.cosmetics.owned.filter((id) => id !== g.id);
      if (sign > 0) owned.push(g.id);
      const kind = COSMETIC_BY_ID.get(g.id)?.kind;
      const equipped = { ...row.cosmetics.equipped };
      if (sign < 0 && kind && equipped[kind] === g.id) equipped[kind] = kind === 'title' ? '' : `${kind}_default`;
      row.cosmetics = { owned, equipped };
      break;
    }
    case 'pass':
      row.pass = { ...row.pass, premium: sign > 0 };
      break;
    case 'no_ads':
      row.perks = { ...row.perks, noAds: sign > 0 };
      break;
    case 'save_slot':
      row.perks = { ...row.perks, saveSlots: sign > 0 ? 2 : 1 };
      break;
    case 'second_chance':
      row.perks = { ...row.perks, secondChanceTokens: Math.max(0, row.perks.secondChanceTokens + sign * g.count) };
      break;
    case 'resources':
      // A refund may push the balance below zero only down to zero: spent resources are not clawed back further.
      row.profile = {
        ...row.profile,
        coral: Math.max(0, row.profile.coral + sign * g.coral),
        shine: Math.max(0, row.profile.shine + sign * g.shine),
      };
      break;
  }
  return { ...g };
}

/** The only place where a purchase is delivered. Idempotent by telegram_payment_charge_id. */
export async function successfulPayment(ctx: Ctx, input: { payload: string; currency: string; totalAmount: number; chargeId: string }): Promise<{ ok: true; duplicate: boolean; productTitle?: string }> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [dup] = await tx.select().from(payments).where(eq(payments.chargeId, input.chargeId));
    if (dup) return { ok: true as const, duplicate: true };
    const [o] = await tx.select().from(payments).where(eq(payments.id, input.payload)).for('update');
    const product = o ? PRODUCT_BY_ID.get(o.productId) : undefined;
    if (!o || !product) throw new ApiFail('order_not_found', 404);
    if (o.status !== 'pending') return { ok: true as const, duplicate: true };
    const row = await lockPlayer(tx, o.playerId);
    const granted = applyGrant(row, product, 1);
    row.paidStars += input.totalAmount;
    await savePlayer(tx, row);
    await tx.update(payments).set({ status: 'paid', chargeId: input.chargeId, paidAt: now, granted, stars: input.totalAmount }).where(eq(payments.id, o.id));
    await addInbox(tx, now, row.id, 'purchase', { ru: 'Спасибо за покупку!', en: 'Thank you for the purchase!' },
      { ru: `«${productTitle(product.id, 'ru')}» уже у тебя.`, en: `"${productTitle(product.id, 'en')}" is yours.` }, null);
    await track(tx, now, row.id, 'purchase', { product: product.id, stars: input.totalAmount });
    return { ok: true as const, duplicate: false, productTitle: productTitle(product.id, row.lang) };
  });
}

/** Refund: asks Telegram through the bot first, then takes the goods back. */
export async function refundPayment(ctx: Ctx, orderId: string): Promise<{ ok: boolean; error?: string }> {
  const now = ctx.now();
  const [o] = await ctx.db.select().from(payments).where(eq(payments.id, orderId));
  if (!o) throw new ApiFail('order_not_found', 404);
  if (o.status !== 'paid' || !o.chargeId) throw new ApiFail('order_not_paid');
  if (!ctx.bot) throw new ApiFail('shop_disabled', 503);
  const [player] = await ctx.db.select().from(players).where(eq(players.id, o.playerId));
  if (!player?.tgId) throw new ApiFail('no_telegram');
  const res = await ctx.bot.refund(player.tgId, o.chargeId);
  if (!res.ok && res.error !== 'CHARGE_ALREADY_REFUNDED') return res;
  await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(payments).where(eq(payments.id, orderId)).for('update');
    if (!locked || locked.status !== 'paid') return;
    const product = PRODUCT_BY_ID.get(locked.productId);
    const row = await lockPlayer(tx, locked.playerId);
    if (product) applyGrant(row, product, -1);
    row.paidStars = Math.max(0, row.paidStars - locked.stars);
    await savePlayer(tx, row);
    await tx.update(payments).set({ status: 'refunded', refundedAt: now }).where(eq(payments.id, orderId));
    await track(tx, now, row.id, 'refund', { product: locked.productId, stars: locked.stars });
  });
  return { ok: true };
}

/** HTTP client for the bot's internal API. */
export function httpBotClient(baseUrl: string, secret: string): BotClient {
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`bot ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    async invoiceLink(input) {
      return (await call<{ url: string }>('/internal/invoice-link', input)).url;
    },
    refund(tgId, chargeId) {
      return call<{ ok: boolean; error?: string }>('/internal/refund', { tgId, telegramPaymentChargeId: chargeId });
    },
  };
}
