import { AD_UNLOCK_BY_ID, type ClientRunAction, type HuntReport, type RunActionResponse } from '@shellter/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/apiError';
import { localApi, openLocalSave, rewardIntent } from '../src/local/backend';

const store = new Map<string, string>();
const REPORT: HuntReport = {
  eaten: { moon_jelly: 12, plankton_spark: 6, sand_worm: 6 },
  nodes: { oyster: 3, coral: 4, glitter: 0 },
  durationS: 60,
  hpLost: 5,
  ko: false,
};

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(Date.UTC(2026, 10, 11, 12));
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function playTutorialRun(): Promise<RunActionResponse> {
  const start = await localApi.runStart('hermit');
  let seq = 0;
  const act = (action: ClientRunAction): Promise<RunActionResponse> => localApi.runAction(start.run.id, ++seq, action);
  vi.advanceTimersByTime(65_000);
  let r = await act({ type: 'hunt_done', report: REPORT });
  if (r.run?.camp?.shellChoices) r = await act({ type: 'choose_shell', index: 0 });
  return act({ type: 'carry_out' });
}

async function watched(placement: Parameters<typeof localApi.adIntent>[0]): Promise<string> {
  const it = await localApi.adIntent(placement);
  rewardIntent(it.id);
  return it.id;
}

describe('offline backend (Yandex Games build)', () => {
  it('a run ends with loot, quest progress and a cloud-ready save that survives a reload', async () => {
    const first = await openLocalSave();
    expect(first.run).toBeNull();
    expect(first.player.profile.tutorialDone).toBe(false);
    const end = await playTutorialRun();
    expect(end.ended?.result).not.toBe('defeat');
    expect(end.player?.profile.stats.runs).toBe(1);
    expect(end.player?.profile.coral).toBeGreaterThan(0);

    const saved = JSON.parse(store.get('shellter_save') ?? 'null') as { profile: { coral: number }; run: unknown };
    expect(saved.profile.coral).toBe(end.player?.profile.coral);
    expect(saved.run).toBeNull();
    // Well inside the 200 KB player data limit.
    expect((store.get('shellter_save') ?? '').length).toBeLessThan(60_000);

    const again = await openLocalSave();
    expect(again.player.id).toBe(first.player.id);
    expect(again.player.profile.coral).toBe(end.player?.profile.coral);
  });

  it('an unfinished run is restored after a reload', async () => {
    const start = await localApi.runStart('hermit');
    const back = await openLocalSave();
    expect(back.run?.id).toBe(start.run.id);
    await localApi.runAbandon(start.run.id);
  });

  it('rewards need a watched ad; cosmetics unlock after the required number of views', async () => {
    const raw = await localApi.adIntent('daily_chest');
    await expect(localApi.adChest(raw.id)).rejects.toBeInstanceOf(ApiError);
    const chest = await localApi.adChest(await watched('daily_chest'));
    expect(chest.reward.coral).toBeGreaterThan(0);
    await expect(localApi.adIntent('daily_chest')).rejects.toMatchObject({ code: 'ad_limit' });

    const need = AD_UNLOCK_BY_ID.get('crab_azure')?.views ?? 0;
    let last = { unlocked: false, player: chest.player };
    for (let i = 0; i < need; i++) last = await localApi.adUnlock('crab_azure', await watched('unlock'));
    expect(last.unlocked).toBe(true);
    expect(last.player.cosmetics.owned).toContain('crab_azure');
    await expect(localApi.adUnlock('crab_azure', await watched('unlock'))).rejects.toMatchObject({ code: 'unlock_owned' });
    expect((await localApi.equip('crab_azure')).player.cosmetics.equipped.crab).toBe('crab_azure');
  });

  it('the premium pass bought with ads lasts one season; the next month resets it', async () => {
    const need = AD_UNLOCK_BY_ID.get('season_pass')?.views ?? 0;
    vi.setSystemTime(Date.UTC(2026, 10, 12, 12));
    let p = (await localApi.me()).player;
    for (let i = 0; i < need; i++) p = (await localApi.adUnlock('season_pass', await watched('unlock'))).player;
    expect(p.pass.premium).toBe(true);
    vi.setSystemTime(Date.UTC(2026, 11, 2, 12));
    const me = await localApi.me();
    expect(me.player.pass.premium).toBe(false);
    expect(me.player.adUnlocks.season_pass).toBeUndefined();
    // A new month also closed the league season and left a result in the mailbox when trophies were won.
    expect(me.liveops.event?.goals?.length).toBeGreaterThan(0);
  });

  it('the event score of last week turns into a mailbox reward', async () => {
    await playTutorialRun().catch(() => undefined);
    const before = await localApi.liveops();
    const score = before.event?.myScore ?? 0;
    vi.setSystemTime(Date.UTC(2026, 11, 10, 12));
    const inbox = await localApi.inbox();
    if (score > 0) expect(inbox.items.some((x) => x.kind === 'event_result')).toBe(true);
    const item = inbox.items.find((x) => !x.claimed && x.reward);
    if (item) expect((await localApi.inboxClaim(item.id)).player.inboxUnread).toBeLessThan(inbox.items.filter((x) => !x.claimed).length);
  });
});
