import type {
  BuildSnapshot, CosmeticKind, KrakenConfig, LiveEventConfig, LocalText, Profile, QuestState, RunState,
} from '@shellter/shared';
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const ms = (name: string) => bigint(name, { mode: 'number' });

export interface CosmeticsState {
  owned: string[];
  equipped: Record<CosmeticKind, string>;
  /** Ad unlock id -> rewarded ads watched towards it. */
  adViews?: Record<string, number>;
}
export interface PassState {
  season: string;
  xp: number;
  premium: boolean;
  claimedFree: number[];
  claimedPremium: number[];
}
export interface PerksState {
  noAds: boolean;
  secondChanceTokens: number;
  saveSlots: number;
}
export interface NotifyState {
  enabled: boolean;
  corf: boolean;
  events: boolean;
  kraken: boolean;
  /** Unix ms of the last triggered notification per kind (frequency cap). */
  last: Record<string, number>;
}
export interface Reward {
  coral?: number;
  shine?: number;
  cosmetic?: string;
}

export const players = pgTable('players', {
  id: text('id').primaryKey(),
  tgId: ms('tg_id').unique(),
  guestHash: text('guest_hash').unique(),
  name: text('name').notNull(),
  lang: text('lang').notNull().default('ru'),
  guest: boolean('guest').notNull().default(true),
  profile: jsonb('profile').$type<Profile>().notNull(),
  quests: jsonb('quests').$type<QuestState | null>(),
  cosmetics: jsonb('cosmetics').$type<CosmeticsState>().notNull(),
  pass: jsonb('pass').$type<PassState>().notNull(),
  perks: jsonb('perks').$type<PerksState>().notNull(),
  notify: jsonb('notify').$type<NotifyState>().notNull(),
  lastBuild: jsonb('last_build').$type<BuildSnapshot | null>(),
  trophies: integer('trophies').notNull().default(0),
  botBlocked: boolean('bot_blocked').notNull().default(false),
  referrerId: text('referrer_id'),
  paidStars: integer('paid_stars').notNull().default(0),
  createdAt: ms('created_at').notNull(),
  lastSeenAt: ms('last_seen_at').notNull(),
}, (t) => [index('players_trophies_idx').on(t.trophies), index('players_seen_idx').on(t.lastSeenAt)]);

export const runs = pgTable('runs', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  slot: integer('slot').notNull().default(0),
  state: jsonb('state').$type<RunState>().notNull(),
  status: text('status').$type<'active' | 'ended'>().notNull(),
  seq: integer('seq').notNull().default(0),
  lastResponse: jsonb('last_response'),
  huntStartedAt: ms('hunt_started_at'),
  startedAt: ms('started_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
  heroId: text('hero_id').notNull(),
  stageReached: integer('stage_reached').notNull().default(1),
  result: text('result'),
  eventId: text('event_id'),
  /** Rewards granted at the end (for the "double loot" ad). */
  rewards: jsonb('rewards').$type<{ coral: number; shine: number; doubled: boolean } | null>(),
}, (t) => [
  uniqueIndex('runs_active_slot_idx').on(t.playerId, t.slot).where(sql`status = 'active'`),
  index('runs_player_idx').on(t.playerId, t.startedAt),
]);

export const ghosts = pgTable('ghosts', {
  id: text('id').primaryKey(),
  playerId: text('player_id'),
  name: text('name').notNull(),
  stage: integer('stage').notNull(),
  power: integer('power').notNull(),
  build: jsonb('build').$type<BuildSnapshot>().notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [uniqueIndex('ghosts_player_stage_idx').on(t.playerId, t.stage), index('ghosts_stage_power_idx').on(t.stage, t.power)]);

export interface SeasonConfig {
  id: string;
  startsAt: number;
  endsAt: number;
}
export const liveEvents = pgTable('live_events', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'event' | 'kraken' | 'season'>().notNull(),
  config: jsonb('config').$type<LiveEventConfig | KrakenConfig | SeasonConfig>().notNull(),
  startsAt: ms('starts_at').notNull(),
  endsAt: ms('ends_at').notNull(),
  finalized: boolean('finalized').notNull().default(false),
}, (t) => [index('live_events_kind_idx').on(t.kind, t.startsAt)]);

export const eventScores = pgTable('event_scores', {
  eventId: text('event_id').notNull(),
  playerId: text('player_id').notNull(),
  score: integer('score').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.eventId, t.playerId] }), index('event_scores_rank_idx').on(t.eventId, t.score)]);

export const krakenHits = pgTable('kraken_hits', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  krakenId: text('kraken_id').notNull(),
  playerId: text('player_id').notNull(),
  damage: integer('damage').notNull(),
  day: text('day').notNull(),
  ts: ms('ts').notNull(),
}, (t) => [index('kraken_hits_idx').on(t.krakenId, t.playerId)]);

export const krakenClaims = pgTable('kraken_claims', {
  krakenId: text('kraken_id').notNull(),
  playerId: text('player_id').notNull(),
  pct: integer('pct').notNull(),
}, (t) => [primaryKey({ columns: [t.krakenId, t.playerId, t.pct] })]);

export const inbox = pgTable('inbox', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  kind: text('kind').notNull(),
  title: jsonb('title').$type<LocalText>().notNull(),
  body: jsonb('body').$type<LocalText>().notNull(),
  reward: jsonb('reward').$type<Reward | null>(),
  createdAt: ms('created_at').notNull(),
  claimedAt: ms('claimed_at'),
}, (t) => [index('inbox_player_idx').on(t.playerId, t.createdAt)]);

export const payments = pgTable('payments', {
  /** Order id; also the invoice payload. */
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  productId: text('product_id').notNull(),
  stars: integer('stars').notNull(),
  status: text('status').$type<'pending' | 'paid' | 'refunded'>().notNull(),
  chargeId: text('charge_id').unique(),
  /** What was granted, so a refund can take it back. */
  granted: jsonb('granted').$type<Record<string, unknown> | null>(),
  createdAt: ms('created_at').notNull(),
  paidAt: ms('paid_at'),
  refundedAt: ms('refunded_at'),
}, (t) => [index('payments_player_idx').on(t.playerId, t.createdAt)]);

export const adIntents = pgTable('ad_intents', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  placement: text('placement').notNull(),
  status: text('status').$type<'pending' | 'rewarded' | 'consumed'>().notNull(),
  day: text('day').notNull(),
  createdAt: ms('created_at').notNull(),
  rewardedAt: ms('rewarded_at'),
}, (t) => [index('ad_intents_player_idx').on(t.playerId, t.day)]);

export interface OutboxButton {
  text: string;
  kind: 'webapp' | 'url';
  url: string;
}
export const outbox = pgTable('outbox', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  chatId: ms('chat_id').notNull(),
  text: text('text').notNull(),
  button: jsonb('button').$type<OutboxButton | null>(),
  status: text('status').$type<'queued' | 'claimed' | 'sent' | 'blocked' | 'failed'>().notNull(),
  kind: text('kind').notNull(),
  broadcastId: text('broadcast_id'),
  notBefore: ms('not_before').notNull(),
  claimedAt: ms('claimed_at'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: ms('created_at').notNull(),
  doneAt: ms('done_at'),
}, (t) => [index('outbox_queue_idx').on(t.status, t.notBefore), index('outbox_broadcast_idx').on(t.broadcastId)]);

export interface Segment {
  kind: 'all' | 'inactive' | 'event' | 'payers';
  /** For `inactive`: days without a session. */
  days?: number;
  /** For `event`: event id. */
  eventId?: string;
}
export const broadcasts = pgTable('broadcasts', {
  id: text('id').primaryKey(),
  segment: jsonb('segment').$type<Segment>().notNull(),
  text: jsonb('text').$type<LocalText>().notNull(),
  button: jsonb('button').$type<OutboxButton | null>(),
  scheduledAt: ms('scheduled_at').notNull(),
  status: text('status').$type<'scheduled' | 'queued' | 'cancelled'>().notNull(),
  total: integer('total').notNull().default(0),
  createdAt: ms('created_at').notNull(),
});

export const analytics = pgTable('analytics_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  playerId: text('player_id'),
  sessionId: text('session_id'),
  type: text('type').notNull(),
  props: jsonb('props').$type<Record<string, unknown>>(),
  ts: ms('ts').notNull(),
}, (t) => [index('analytics_type_idx').on(t.type, t.ts), index('analytics_player_idx').on(t.playerId, t.ts)]);

export const referrals = pgTable('referrals', {
  inviteeId: text('invitee_id').primaryKey(),
  referrerId: text('referrer_id').notNull(),
  createdAt: ms('created_at').notNull(),
});
