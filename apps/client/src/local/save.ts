import type {
  AdPlacement, BuildSnapshot, CosmeticKind, InboxItem, Profile, QuestState, RunState,
} from '@shellter/shared';
import { cloudLoad, cloudSave } from '../platform/yandex';

/**
 * Everything the offline build knows about the player. One JSON document: the Yandex cloud keeps
 * it (player.setData, 200 KB limit), localStorage mirrors it for instant start and offline play.
 */
export interface SaveData {
  v: 1;
  id: string;
  name: string;
  lang: 'ru' | 'en';
  /** Set by the player in the settings; the platform language is used until then. */
  langChosen?: boolean;
  savedAt: number;
  profile: Profile;
  quests: QuestState | null;
  cosmetics: { owned: string[]; equipped: Record<CosmeticKind, string> };
  pass: { season: string; xp: number; premium: boolean; claimedFree: number[]; claimedPremium: number[] };
  lastBuild: (BuildSnapshot & { name: string }) | null;
  run: SavedRun | null;
  /** The last finished run, for the "double loot" ad on the result screen. */
  lastEnded: { runId: string; result: string; coral: number; shine: number; doubled: boolean; at: number } | null;
  ads: { day: string; counts: Partial<Record<AdPlacement, number>> };
  adUnlocks: Record<string, number>;
  inbox: InboxItem[];
  event: { id: string; score: number } | null;
  kraken: { id: string; damage: number; day: string; today: number; claimed: number[] } | null;
  /** YYYY-MM of the league season the trophies belong to. */
  season: string;
}

export interface SavedRun {
  id: string;
  state: RunState;
  seq: number;
  startedAt: number;
  huntStartedAt: number;
  eventId: string | null;
}

const KEY = 'save';
const LOCAL_KEY = 'shellter_save';
/** setData allows 100 calls per 5 minutes; one regular write per 5 s stays far below. */
const CLOUD_GAP_MS = 5000;

function readLocal(): SaveData | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}

function valid(x: unknown): x is SaveData {
  return typeof x === 'object' && x !== null && (x as SaveData).v === 1 && typeof (x as SaveData).profile === 'object';
}

/** Newest of the cloud and the local copy. */
export async function loadSave(): Promise<SaveData | null> {
  const local = readLocal();
  const cloud = await cloudLoad(KEY);
  const a = valid(local) ? local : null;
  const b = valid(cloud) ? cloud : null;
  if (a && b) return a.savedAt >= b.savedAt ? a : b;
  return a ?? b;
}

let pending: SaveData | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastCloud = 0;

function pushCloud(flush: boolean): void {
  if (!pending) return;
  const data = pending;
  pending = null;
  lastCloud = Date.now();
  void cloudSave(KEY, data as unknown as Record<string, unknown>, flush);
}

/**
 * Stores the save. localStorage is written at once; the cloud gets the newest copy at most every
 * few seconds, and right away (flushed) for `important` changes such as the end of a run.
 */
export function writeSave(data: SaveData, important = false): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch {
    /* private mode or quota: the cloud copy still works */
  }
  pending = data;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const wait = CLOUD_GAP_MS - (Date.now() - lastCloud);
  if (important || wait <= 0) pushCloud(important);
  else timer = setTimeout(() => {
    timer = null;
    pushCloud(false);
  }, wait);
}

/** Sends a waiting copy now; called when the page is being hidden. */
export function flushSave(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pushCloud(true);
}
