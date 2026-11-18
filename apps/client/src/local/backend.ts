import {
  AD_DAILY_CAPS, AD_DAILY_TOTAL, AD_UNLOCK_BY_ID, applyQuestDeltas, applyRunAction, applyRunEnd, botGhosts, BOT_STAGES, buildOf,
  buyTalent, claimMilestone, collectCorf, corfState, CORF_BOOST_MULT, COSMETIC_BY_ID, createRng, DAILY_CHEST_REWARD, dayKey, DEFAULT_EVENTS,
  eventGoals, eventModifier, eventScore, LEAGUES, leagueOf,
  MetaError, newProfile, PASS_LEVELS, PASS_REWARDS, PASS_XP_PER_LEVEL, publicRun, QUEST_BY_ID, questDeltasForRun, ratePower, refreshQuests,
  runConfigFor, RunError, runFighter, selectHero, setGardenOff, startRun, stageInfo, STAGES_PER_SEGMENT,
  upgradeBuilding,
  type AdIntentView, type AdPlacement, type BuildingId, type ClientRunAction, type Cost, type CosmeticKind, type Enemy, type InboxItem,
  type LeagueId, type LiveEventConfig, type LiveopsView, type MeResponse, type PlayerView, type PublicRun,
  type RunAction, type RunActionResponse, type RunEnded, type RunEvent, type RunState,
} from '@shellter/shared';
import { ApiError } from '../apiError';
import { getYaPlayer, isAuthorized, leaderboardTop, now as clock, submitTrophies, yandexLang } from '../platform/yandex';
import { loadSave, writeSave, type SaveData } from './save';

/**
 * The game without a server: the same API the HTTP client offers, computed in the browser with the
 * shared rules and stored in the Yandex cloud save. Rivals are the fixed bots, events are personal
 * score goals, the league is the Yandex leaderboard of all-time trophies. No Kraken: it needs a
 * shared boss.
 */

const DEFAULT_EQUIPPED: Record<CosmeticKind, string> = { crab: 'crab_default', shell: 'shell_default', merge: 'merge_default', town: 'town_default', title: '' };
const WEEK = 7 * 86_400_000;
/** Quests the offline build cannot complete. */
const NO_QUESTS = ['kraken_hit'] as const;
const LEAGUE_COSMETIC: Partial<Record<LeagueId, string>> = { platinum: 'title_gold_claw', diamond: 'crab_abyss', legend: 'title_reef_legend' };
const LEAGUE_NAME: Record<LeagueId, { ru: string; en: string }> = {
  bronze: { ru: 'Бронза', en: 'Bronze' },
  silver: { ru: 'Серебро', en: 'Silver' },
  gold: { ru: 'Золото', en: 'Gold' },
  platinum: { ru: 'Платина', en: 'Platinum' },
  diamond: { ru: 'Алмаз', en: 'Diamond' },
  legend: { ru: 'Легенда', en: 'Legend' },
};

let S: SaveData | null = null;

function rid(n = 12): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

function fail(code: string, status = 400): never {
  throw new ApiError(code, status);
}

function save(): SaveData {
  if (!S) fail('unauthorized', 401);
  return S;
}

/** Runs `fn` against the save and stores it. Rule errors become API errors, as on the server. */
function tx<T>(fn: (s: SaveData, now: number) => T, important = false): Promise<T> {
  const s = save();
  const now = clock();
  try {
    const out = fn(s, now);
    s.savedAt = now;
    writeSave(s, important);
    submitTrophies(s.profile.trophies);
    return Promise.resolve(out);
  } catch (e) {
    if (e instanceof MetaError || e instanceof RunError) return Promise.reject(new ApiError(e.code, 400));
    return Promise.reject(e);
  }
}

// --- Calendar ---------------------------------------------------------------------------------------

function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const seasonKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

function currentEvent(now: number): LiveEventConfig {
  const start = weekStart(now);
  const base = DEFAULT_EVENTS[Math.floor(start / WEEK) % DEFAULT_EVENTS.length] as (typeof DEFAULT_EVENTS)[number];
  return { ...base, id: `${base.id}_${isoDay(start)}`, startsAt: start, endsAt: start + WEEK };
}

function eventById(id: string): LiveEventConfig | null {
  const base = DEFAULT_EVENTS.find((e) => id.startsWith(`${e.id}_`));
  if (!base) return null;
  const start = Date.parse(`${id.slice(base.id.length + 1)}T00:00:00Z`);
  return Number.isFinite(start) ? { ...base, id, startsAt: start, endsAt: start + WEEK } : null;
}


// --- Player -----------------------------------------------------------------------------------------

function grant(s: SaveData, reward: { coral?: number; shine?: number; cosmetic?: string } | null | undefined, mult = 1): void {
  if (!reward) return;
  s.profile = {
    ...s.profile,
    coral: s.profile.coral + Math.round((reward.coral ?? 0) * mult),
    shine: s.profile.shine + Math.round((reward.shine ?? 0) * mult),
  };
  if (reward.cosmetic && !s.cosmetics.owned.includes(reward.cosmetic)) s.cosmetics = { ...s.cosmetics, owned: [...s.cosmetics.owned, reward.cosmetic] };
}

function addInbox(s: SaveData, now: number, kind: string, title: InboxItem['title'], body: InboxItem['body'], reward: InboxItem['reward']): void {
  s.inbox = [{ id: rid(), kind, title, body, reward, createdAt: now, claimed: false }, ...s.inbox].slice(0, 30);
}

/** Period changes: quests, pass season, ad counters, finished events; rewards for a new league. */
function refresh(s: SaveData, now: number): void {
  s.quests = refreshQuests(s.quests, s.id, now, NO_QUESTS);
  const season = seasonKey(now);
  if (s.pass.season !== season) {
    s.pass = { season, xp: 0, claimed: [] };
  } else if (!Array.isArray(s.pass.claimed)) {
    // Saves from before the single track.
    s.pass = { season: s.pass.season, xp: s.pass.xp, claimed: (s.pass as { claimedFree?: number[] }).claimedFree ?? [] };
  }
  const day = dayKey(now);
  if (s.ads.day !== day) s.ads = { day, counts: {} };

  const ev = currentEvent(now);
  if (s.event && s.event.id !== ev.id) {
    const old = eventById(s.event.id);
    const best = old ? eventGoals(old, s.event.score).find((g) => g.reached) : undefined;
    if (old && best) {
      addInbox(s, now, 'event_result', { ru: `Итоги: ${old.title.ru}`, en: `Results: ${old.title.en}` },
        { ru: `Очки события: ${s.event.score}.`, en: `Event points: ${s.event.score}.` },
        best.cosmetic ? { ...best.reward, cosmetic: best.cosmetic } : best.reward);
    }
    s.event = null;
  }
  // The leaderboard has no seasons, so trophies are never cut; reaching a league pays once.
  const reached = LEAGUES.findIndex((l) => l.id === leagueOf(s.profile.trophies));
  for (let i = (s.leagueBest ?? 0) + 1; i <= reached; i++) {
    const l = LEAGUES[i] as (typeof LEAGUES)[number];
    const cosmetic = LEAGUE_COSMETIC[l.id];
    addInbox(s, now, 'league_up', { ru: 'Новая лига', en: 'New league' }, { ru: `Лига «${LEAGUE_NAME[l.id].ru}».`, en: `${LEAGUE_NAME[l.id].en} league.` },
      cosmetic ? { coral: 100 * (i + 1), cosmetic } : { coral: 100 * (i + 1) });
  }
  if (reached > (s.leagueBest ?? 0)) s.leagueBest = reached;
}

function ownedCosmetics(s: SaveData): string[] {
  const free = [...COSMETIC_BY_ID.values()].filter((x) => x.source === 'free').map((x) => x.id);
  return [...new Set([...free, ...s.cosmetics.owned])];
}

function view(s: SaveData, now: number): PlayerView {
  refresh(s, now);
  const corf = corfState(s.profile, now);
  return {
    id: s.id,
    name: s.name,
    lang: s.lang,
    guest: !isAuthorized(),
    profile: s.profile,
    quests: s.quests as NonNullable<SaveData['quests']>,
    cosmetics: { owned: ownedCosmetics(s), equipped: { ...DEFAULT_EQUIPPED, ...s.cosmetics.equipped } },
    pass: s.pass,
    perks: { noAds: false, secondChanceTokens: 0, saveSlots: 1 },
    corf: { amount: corf.amount, cap: corf.cap, full: corf.full },
    league: leagueOf(s.profile.trophies),
    inboxUnread: s.inbox.filter((x) => !x.claimed).length,
    adsToday: { ...s.ads.counts },
    adUnlocks: { ...s.adUnlocks },
    serverTime: now,
  };
}

function liveopsView(s: SaveData, now: number): LiveopsView {
  refresh(s, now);
  const ev = currentEvent(now);
  const score = s.event?.id === ev.id ? s.event.score : 0;
  return {
    event: { config: ev, myScore: score, myRank: null, top: [], goals: eventGoals(ev, score) },
    kraken: null,
    league: { trophies: s.profile.trophies, league: leagueOf(s.profile.trophies), season: null, top: [], myRank: null },
  };
}

function newSave(now: number, name: string, lang: 'ru' | 'en'): SaveData {
  return {
    v: 1,
    id: rid(9),
    name,
    lang,
    savedAt: now,
    profile: newProfile(now),
    quests: null,
    cosmetics: { owned: [], equipped: { ...DEFAULT_EQUIPPED } },
    pass: { season: seasonKey(now), xp: 0, claimed: [] },
    lastBuild: null,
    run: null,
    lastEnded: null,
    ads: { day: dayKey(now), counts: {} },
    adUnlocks: {},
    inbox: [],
    event: null,
    leagueBest: 0,
  };
}

/** Loads (or creates) the save. Called once at boot instead of a login. */
export async function openLocalSave(): Promise<{ player: PlayerView; run: PublicRun | null }> {
  const yp = await getYaPlayer();
  const now = clock();
  const platformLang = yandexLang() ?? (/^(ru|uk|be|kk)/i.test(navigator.language) ? 'ru' : 'en');
  S = await loadSave();
  if (!S) {
    const yaName = yp?.isAuthorized() ? yp.getName().trim().slice(0, 24) : '';
    S = newSave(now, yaName || `${platformLang === 'ru' ? 'Рачок' : 'Crab'} ${Math.floor(1000 + Math.random() * 9000)}`, platformLang);
  } else if (!S.langChosen) S.lang = platformLang;
  const s = S;
  const player = view(s, now);
  writeSave(s);
  return { player, run: s.run ? publicRun(s.run.state, s.run.seq) : null };
}

// --- Ads --------------------------------------------------------------------------------------------

const intents = new Map<string, AdIntentView>();

/** Marks an intent rewarded after the platform's onRewarded callback. */
export function rewardIntent(id: string): void {
  const it = intents.get(id);
  if (!it || it.status !== 'pending') return;
  it.status = 'rewarded';
  const s = save();
  refresh(s, clock());
  s.ads.counts = { ...s.ads.counts, [it.placement]: (s.ads.counts[it.placement] ?? 0) + 1 };
}

function consumeAd(id: string | undefined, placement: AdPlacement): boolean {
  const it = id ? intents.get(id) : undefined;
  if (!it || it.placement !== placement || it.status !== 'rewarded') return false;
  it.status = 'consumed';
  return true;
}

function adIntent(placement: AdPlacement): Promise<AdIntentView> {
  return tx((s, now) => {
    refresh(s, now);
    const c = s.ads.counts;
    const total = Object.entries(c).reduce((a, [k, n]) => (k === 'unlock' ? a : a + (n ?? 0)), 0);
    if ((placement !== 'unlock' && total >= AD_DAILY_TOTAL) || (c[placement] ?? 0) >= AD_DAILY_CAPS[placement]) fail('ad_limit');
    const it: AdIntentView = { id: rid(), placement, status: 'pending' };
    intents.set(it.id, it);
    return { ...it };
  });
}

// --- Runs -------------------------------------------------------------------------------------------

function pickGhost(s: SaveData, state: RunState, stage: number): Extract<Enemy, { kind: 'ghost' }> | null {
  if (stageInfo(stage).kind !== 'guardian') return null;
  const bossStage = (stage / STAGES_PER_SEGMENT) % 4 === 0;
  if (stage < 6 || bossStage || s.profile.stats.runs < 2 || stage > BOT_STAGES.to) return null;
  if (!createRng(`${state.seed}/ghost/${stage}`).chance(0.5)) return null;
  const power = ratePower(runFighter(state));
  const fit = botGhosts(stage).filter((g) => g.power >= Math.floor(power * 0.75) && g.power <= Math.ceil(power * 1.2));
  const g = fit.sort((a, b) => Math.abs(a.power - power) - Math.abs(b.power - power))[0];
  return g ? { kind: 'ghost', ghostId: g.id, name: g.name, build: g.build, power: g.power } : null;
}

function pickRival(state: RunState, stage: number): Extract<Enemy, { kind: 'ghost' }> | null {
  const s = Math.min(stage, BOT_STAGES.to);
  if (s < BOT_STAGES.from) return null;
  const power = ratePower(runFighter(state));
  const g = botGhosts(s).sort((a, b) => Math.abs(a.power - power) - Math.abs(b.power - power))[0];
  return g ? { kind: 'ghost', ghostId: g.id, name: g.name, build: g.build, power: g.power } : null;
}

function finishRun(s: SaveData, now: number, runId: string, eventId: string | null, state: RunState): RunEnded {
  const { profile, summary } = applyRunEnd(s.profile, state);
  s.profile = profile;
  s.lastBuild = { ...buildOf(state), name: s.name };
  refresh(s, now);
  const before = s.quests;
  const after = before ? applyQuestDeltas(before, questDeltasForRun(state)) : before;
  const questsCompleted: string[] = [];
  if (before && after) {
    const done = (list: typeof after.daily, old: typeof after.daily): void =>
      list.forEach((q, i) => {
        const def = QUEST_BY_ID.get(q.id);
        if (def && q.progress >= def.need && (old[i]?.progress ?? 0) < def.need) questsCompleted.push(q.id);
      });
    done(after.daily, before.daily);
    done(after.weekly, before.weekly);
    s.quests = after;
  }
  const ended: RunEnded = { result: state.result ?? 'defeat', summary, questsCompleted, runId };
  const ev = eventId ? eventById(eventId) : null;
  if (ev && ev.endsAt > now) {
    const score = eventScore(state, ev);
    if (score > 0) s.event = { id: ev.id, score: (s.event?.id === ev.id ? s.event.score : 0) + score };
    ended.eventScore = score;
  }
  s.lastEnded = { runId, result: ended.result, coral: summary.coral, shine: summary.shine, doubled: false, at: now };
  s.run = null;
  return ended;
}

function runAction(runId: string, seq: number, action: ClientRunAction): Promise<RunActionResponse> {
  return tx((s, now) => {
    const run = s.run;
    if (!run || run.id !== runId) fail('run_not_found', 404);
    if (seq !== run.seq + 1) fail('bad_seq', 409);
    let state = run.state;
    let mapped: RunAction;
    switch (action.type) {
      case 'reroll':
        if (action.adIntentId) {
          if (state.flags.adReroll) fail('ad_reroll_used');
          if (!consumeAd(action.adIntentId, 'reroll')) fail('ad_not_verified');
          mapped = { type: 'reroll', free: true };
        } else mapped = { type: 'reroll' };
        break;
      case 'second_chance':
        if (state.phase !== 'down' || state.flags.secondChance) fail('bad_phase');
        if (!consumeAd(action.adIntentId, 'second_chance')) fail('ad_not_verified');
        mapped = { type: 'second_chance' };
        break;
      case 'descend': {
        const next = (state.camp?.after ?? state.stage) + 1;
        const keep = state.battle && state.battle.stage === next && state.battle.enemy.kind === 'ghost' ? state.battle.enemy : null;
        const ghost = keep ?? pickGhost(s, state, next);
        mapped = ghost ? { type: 'descend', ghost } : { type: 'descend' };
        break;
      }
      default:
        mapped = action;
    }
    const prevPhase = state.phase;
    const ctxRun = action.type === 'hunt_done' ? { huntElapsedS: Math.max(0, (now - run.huntStartedAt) / 1000) } : {};
    const out = applyRunAction(state, mapped, ctxRun);
    state = out.state;
    const events: RunEvent[] = out.events.filter((e) => e.type !== 'clamped');
    const camp = state.phase === 'camp' ? state.camp : null;
    if (camp && !state.cfg.tutorial && camp.after >= 2 && !camp.rival && !camp.dueled) {
      const rival = pickRival(state, camp.after);
      if (rival) state = { ...state, camp: { ...camp, rival } };
    }
    const response: RunActionResponse = { run: state.phase === 'ended' ? null : publicRun(state, seq), events };
    if (state.phase === 'ended') {
      response.ended = finishRun(s, now, run.id, run.eventId, state);
    } else {
      s.run = { ...run, state, seq, huntStartedAt: state.phase === 'hunt' && prevPhase !== 'hunt' ? now : run.huntStartedAt };
    }
    if (state.phase === 'ended' || action.type === 'second_chance') response.player = view(s, now);
    return response;
  }, true);
}

// --- Meta helpers -----------------------------------------------------------------------------------

type P = { player: PlayerView };
function meta<T extends object>(fn: (s: SaveData, now: number) => T): Promise<T & P> {
  return tx((s, now) => {
    refresh(s, now);
    const extra = fn(s, now);
    return { ...extra, player: view(s, now) };
  }, true);
}

function unlockGrant(s: SaveData, id: string): void {
  const def = AD_UNLOCK_BY_ID.get(id);
  if (!def) return;
  grant(s, { cosmetic: def.grant.id });
}

/** True when the unlocked cosmetic is already owned. */
export function unlockOwned(p: PlayerView, id: string): boolean {
  const def = AD_UNLOCK_BY_ID.get(id);
  return !def || p.cosmetics.owned.includes(def.grant.id);
}

// --- The API ----------------------------------------------------------------------------------------

const unsupported = (): Promise<never> => Promise.reject(new ApiError('unsupported', 400));

export const localApi = {
  authTelegram: unsupported,
  authGuest: unsupported,
  authLink: unsupported,
  authWidget: unsupported,
  me: (): Promise<MeResponse> =>
    tx((s, now) => ({ player: view(s, now), run: s.run ? publicRun(s.run.state, s.run.seq) : null, liveops: liveopsView(s, now) })),
  settings: (body: { lang?: 'ru' | 'en'; name?: string }) =>
    meta((s) => {
      if (body.lang) {
        s.lang = body.lang;
        s.langChosen = true;
      }
      if (body.name) s.name = body.name;
      return {};
    }),
  notifyGet: unsupported,
  notifySet: unsupported,
  runStart: (heroId: string): Promise<{ run: PublicRun; player: PlayerView }> =>
    tx((s, now) => {
      refresh(s, now);
      if (s.run) fail('run_active');
      const ev = currentEvent(now);
      const cfg = runConfigFor(s.profile, heroId, eventModifier(ev));
      const id = rid();
      const state = startRun(id, rid(18), cfg);
      s.run = { id, state, seq: 0, startedAt: now, huntStartedAt: now, eventId: ev.id };
      if (s.profile.heroId !== heroId) s.profile = { ...s.profile, heroId };
      return { run: publicRun(state), player: view(s, now) };
    }, true),
  runAction,
  runAbandon: (runId: string): Promise<RunActionResponse> =>
    tx((s, now) => {
      const run = s.run;
      if (!run || run.id !== runId) fail('run_not_found', 404);
      const state: RunState = { ...run.state, phase: 'ended', result: 'defeat', camp: null, battle: null };
      const ended = finishRun(s, now, run.id, run.eventId, state);
      return { run: null, events: [{ type: 'ended', result: 'defeat' }], ended, player: view(s, now) };
    }, true),
  runDouble: (runId: string, adIntentId: string) =>
    meta((s, now) => {
      const e = s.lastEnded;
      if (!e || e.runId !== runId) fail('run_not_found', 404);
      if (e.result === 'defeat') fail('double_defeat');
      if (e.doubled) fail('double_used');
      if (now - e.at > 30 * 60_000) fail('double_expired');
      if (!consumeAd(adIntentId, 'double_loot')) fail('ad_not_verified');
      s.profile = { ...s.profile, coral: s.profile.coral + e.coral, shine: s.profile.shine + e.shine };
      s.lastEnded = { ...e, doubled: true };
      return { gained: { coral: e.coral, shine: e.shine } as Cost };
    }),
  upgrade: (building: BuildingId) =>
    meta((s) => {
      s.profile = upgradeBuilding(s.profile, building);
      if (s.quests) s.quests = applyQuestDeltas(s.quests, { upgrade: 1 });
      return {};
    }),
  talent: (id: string) =>
    meta((s) => {
      s.profile = buyTalent(s.profile, id);
      return {};
    }),
  hero: (heroId: string) =>
    meta((s) => {
      s.profile = selectHero(s.profile, heroId);
      return {};
    }),
  garden: (off: string[]) =>
    meta((s) => {
      s.profile = setGardenOff(s.profile, off);
      return {};
    }),
  corf: (adIntentId?: string) =>
    meta((s, now) => {
      let mult = 1;
      if (adIntentId) {
        if (!consumeAd(adIntentId, 'corf_boost')) fail('ad_not_verified');
        mult = CORF_BOOST_MULT;
      }
      const res = collectCorf(s.profile, now, mult);
      s.profile = res.profile;
      return { gained: res.gained };
    }),
  almanacClaim: (id: string) =>
    meta((s) => {
      const res = claimMilestone(s.profile, id);
      s.profile = res.profile;
      return { reward: res.reward };
    }),
  questClaim: (id: string) =>
    meta((s) => {
      const def = QUEST_BY_ID.get(id);
      const q = s.quests;
      const list = def && q ? (def.period === 'daily' ? q.daily : q.weekly) : [];
      const entry = list.find((x) => x.id === id);
      if (!def || !q || !entry) fail('quest_unknown');
      if (entry.claimed) fail('quest_claimed');
      if (entry.progress < def.need) fail('quest_incomplete');
      const mark = (l: typeof q.daily): typeof q.daily => l.map((x) => (x.id === id ? { ...x, claimed: true } : x));
      s.quests = { ...q, daily: mark(q.daily), weekly: mark(q.weekly) };
      grant(s, def.reward);
      s.pass = { ...s.pass, xp: Math.min(PASS_LEVELS * PASS_XP_PER_LEVEL, s.pass.xp + def.reward.passXp) };
      return { reward: def.reward as Cost };
    }),
  passClaim: (level: number) =>
    meta((s) => {
      const def = PASS_REWARDS.find((r) => r.level === level);
      if (!def) fail('pass_unknown');
      if (Math.floor(s.pass.xp / PASS_XP_PER_LEVEL) < level) fail('pass_locked');
      if (s.pass.claimed.includes(level)) fail('pass_claimed');
      s.pass = { ...s.pass, claimed: [...s.pass.claimed, level] };
      grant(s, def.reward);
      return {};
    }),
  equip: (id: string) =>
    meta((s) => {
      const def = COSMETIC_BY_ID.get(id);
      if (!def || !ownedCosmetics(s).includes(id)) fail('cosmetic_locked');
      const current = s.cosmetics.equipped[def.kind];
      s.cosmetics = { ...s.cosmetics, equipped: { ...s.cosmetics.equipped, [def.kind]: def.kind === 'title' && current === id ? '' : id } };
      return {};
    }),
  liveops: async (): Promise<LiveopsView> => {
    const l = await tx((s, now) => liveopsView(s, now));
    const board = await leaderboardTop();
    if (board) l.league = { ...l.league, top: board.top.map((x) => ({ name: x.name, trophies: x.score, rank: x.rank, me: x.me })), myRank: board.myRank };
    return l;
  },
  krakenAttack: unsupported,
  krakenClaim: unsupported,
  inbox: (): Promise<{ items: InboxItem[] }> => tx((s, now) => {
    refresh(s, now);
    return { items: s.inbox.map((x) => ({ ...x })) };
  }),
  inboxClaim: (id: string) =>
    meta((s) => {
      const item = s.inbox.find((x) => x.id === id && !x.claimed);
      if (!item) fail('inbox_claimed');
      s.inbox = s.inbox.map((x) => (x.id === id ? { ...x, claimed: true } : x));
      grant(s, item.reward);
      return { reward: item.reward };
    }),
  adIntent,
  adStatus: (id: string): Promise<AdIntentView> => {
    const it = intents.get(id);
    return it ? Promise.resolve({ ...it }) : Promise.reject(new ApiError('ad_not_found', 404));
  },
  adChest: (id: string) =>
    meta((s) => {
      if (!consumeAd(id, 'daily_chest')) fail('ad_not_verified');
      grant(s, DAILY_CHEST_REWARD);
      return { reward: DAILY_CHEST_REWARD };
    }),
  adUnlock: (id: string, adIntentId: string) =>
    meta((s) => {
      const def = AD_UNLOCK_BY_ID.get(id);
      if (!def) fail('unlock_unknown');
      if (unlockOwned(view(s, clock()), id)) fail('unlock_owned');
      if (!consumeAd(adIntentId, 'unlock')) fail('ad_not_verified');
      const n = (s.adUnlocks[id] ?? 0) + 1;
      if (n >= def.views) {
        unlockGrant(s, id);
        const rest = { ...s.adUnlocks };
        delete rest[id];
        s.adUnlocks = rest;
      } else s.adUnlocks = { ...s.adUnlocks, [id]: n };
      return { unlocked: n >= def.views };
    }),
  analytics: (): Promise<{ ok: true }> => Promise.resolve({ ok: true }),
  devInitData: unsupported,
  devAdWatch: unsupported,
};
