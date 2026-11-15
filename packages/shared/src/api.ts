import { z } from 'zod';
import type { BattleResult } from './battle';
import type { Cost } from './data/town';
import type {
  AdPlacement, CosmeticKind, LeagueId, LiveEventConfig, LocalText, QuestState,
} from './liveops';
import type { Profile, RunSummary } from './meta';
import type { PublicRun, RunEvent, RunResult } from './run';
import type { BuildSnapshot } from './types';

/** HTTP API contract shared by the client and the server. See docs/API.md. */

export interface ApiError {
  error: { code: string; message: string };
}

export interface PlayerView {
  id: string;
  name: string;
  lang: 'ru' | 'en';
  guest: boolean;
  profile: Profile;
  quests: QuestState;
  cosmetics: { owned: string[]; equipped: Record<CosmeticKind, string> };
  pass: { season: string; xp: number; premium: boolean; claimedFree: number[]; claimedPremium: number[] };
  perks: { noAds: boolean; secondChanceTokens: number; saveSlots: number };
  corf: { amount: number; cap: number; full: boolean };
  league: LeagueId;
  inboxUnread: number;
  /** Rewarded ads watched today per placement. */
  adsToday: Partial<Record<AdPlacement, number>>;
  serverTime: number;
}

export interface RunEnded {
  result: RunResult;
  summary: RunSummary;
  questsCompleted: string[];
  eventScore?: number;
  runId: string;
}

export interface AuthResponse {
  token: string;
  /** Guest logins only: the secret to store on the device. */
  secret?: string;
  player: PlayerView;
  run: PublicRun | null;
}

export interface EventView {
  config: LiveEventConfig;
  myScore: number;
  myRank: number | null;
  top: { name: string; score: number }[];
}
export interface KrakenView {
  id: string;
  hpMax: number;
  hpLeft: number;
  endsAt: number;
  myDamage: number;
  attacksLeft: number;
  thresholds: { pct: number; reward: Cost; reached: boolean; claimed: boolean }[];
}
export interface LeagueView {
  trophies: number;
  league: LeagueId;
  season: { id: string; endsAt: number } | null;
  top: { name: string; trophies: number }[];
  myRank: number | null;
}
export interface LiveopsView {
  event: EventView | null;
  kraken: KrakenView | null;
  league: LeagueView;
}

export interface MeResponse {
  player: PlayerView;
  run: PublicRun | null;
  liveops: LiveopsView;
}

export interface RunActionResponse {
  run: PublicRun | null;
  events: RunEvent[];
  player?: PlayerView;
  ended?: RunEnded;
}

export interface KrakenAttackResponse {
  damage: number;
  seed: string;
  build: BuildSnapshot;
  result: BattleResult;
  kraken: KrakenView;
  player: PlayerView;
}

export interface InboxItem {
  id: string;
  kind: string;
  title: LocalText;
  body: LocalText;
  reward: { coral?: number; shine?: number; cosmetic?: string } | null;
  createdAt: number;
  claimed: boolean;
}

export interface ShopView {
  products: { id: string; stars: number; available: boolean; reason?: 'owned' | 'daily_limit' }[];
  /** False when the bot service is not configured: purchase buttons are hidden. */
  enabled: boolean;
}
export interface OrderView {
  id: string;
  productId: string;
  status: 'pending' | 'paid' | 'refunded';
}
export interface AdIntentView {
  id: string;
  placement: AdPlacement;
  status: 'pending' | 'rewarded' | 'consumed';
}

// --- Request bodies --------------------------------------------------------------------------------

const int = z.number().int();
const index = int.min(0).max(64);

export const HuntReportSchema = z.object({
  log: z.array(z.tuple([z.string().max(40), int.min(0).max(1000)])).max(5000).optional(),
  eaten: z.record(z.string().max(40), int.min(0).max(100000)).optional(),
  nodes: z.object({ oyster: int.min(0).max(10000), coral: int.min(0).max(10000), glitter: int.min(0).max(10000), chest: int.min(0).max(10000).optional() }),
  drops: int.min(0).max(10000).optional(),
  trophy: z.boolean().optional(),
  parries: int.min(0).max(10000).optional(),
  durationS: z.number().min(0).max(100000),
  hpLost: z.number().min(-1e7).max(1e7),
  ko: z.boolean(),
});

export const ClientRunActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hunt_done'), report: HuntReportSchema }),
  z.object({ type: z.literal('pick_offer'), index, slot: index.optional() }),
  z.object({ type: z.literal('skip_offer') }),
  z.object({ type: z.literal('buy'), index, slot: index.optional() }),
  z.object({ type: z.literal('order'), of: index, slot: index.optional() }),
  z.object({ type: z.literal('reroll'), adIntentId: z.string().max(64).optional() }),
  z.object({ type: z.literal('sell'), slot: index }),
  z.object({ type: z.literal('move'), from: index, to: index }),
  z.object({ type: z.literal('choose_shell'), index }),
  z.object({ type: z.literal('descend'), path: index.optional() }),
  z.object({ type: z.literal('duel') }),
  z.object({ type: z.literal('carry_out') }),
  z.object({ type: z.literal('battle') }),
  z.object({ type: z.literal('second_chance'), adIntentId: z.string().max(64).optional() }),
  z.object({ type: z.literal('give_up') }),
]);
export type ClientRunAction = z.infer<typeof ClientRunActionSchema>;

export const AuthTelegramBody = z.object({ initData: z.string().min(1).max(8192) });
export const AuthGuestBody = z.object({ secret: z.string().min(16).max(128).optional() });
export const AuthWidgetBody = z.record(z.string().max(32), z.union([z.string().max(1024), z.number()]));
export const SettingsBody = z.object({ lang: z.enum(['ru', 'en']).optional(), name: z.string().trim().min(1).max(24).optional() });
export const StartRunBody = z.object({ heroId: z.string().max(32), slot: int.min(0).max(4).optional() });
export const RunActionBody = z.object({ runId: z.string().max(64), seq: int.min(1), action: ClientRunActionSchema });
export const RunIdBody = z.object({ runId: z.string().max(64) });
export const DoubleLootBody = z.object({ runId: z.string().max(64), adIntentId: z.string().max(64) });
export const UpgradeBody = z.object({ building: z.enum(['lighthouse', 'garden', 'lab', 'workshop', 'hatchery', 'corf', 'school', 'almanac']) });
export const IdBody = z.object({ id: z.string().min(1).max(64) });
export const HeroBody = z.object({ heroId: z.string().max(32) });
export const GardenBody = z.object({ off: z.array(z.string().max(40)).max(100) });
export const CorfBody = z.object({ adIntentId: z.string().max(64).optional() });
export const PassClaimBody = z.object({ level: int.min(1).max(100), track: z.enum(['free', 'premium']) });
export const KrakenClaimBody = z.object({ pct: int.min(1).max(100) });
export const AdIntentBody = z.object({ placement: z.enum(['double_loot', 'second_chance', 'daily_chest', 'reroll', 'corf_boost']) });
export const InvoiceBody = z.object({ productId: z.string().max(40) });
export const AnalyticsBody = z.object({
  sessionId: z.string().max(64),
  events: z.array(z.object({ type: z.string().max(32), props: z.record(z.string().max(32), z.unknown()).optional(), t: z.number() })).max(50),
});
export const NotifyBody = z.object({
  enabled: z.boolean().optional(), corf: z.boolean().optional(), events: z.boolean().optional(), kraken: z.boolean().optional(),
});
