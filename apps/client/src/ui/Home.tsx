import { useSignal } from '@preact/signals';
import {
  ALMANAC_REWARD_MULT, BUILDING_DEFS, BUILDINGS, CORF_RATE_PER_HOUR, HEROES, LIGHTHOUSE_STAGES, MILESTONES, QUEST_BY_ID, SHELLS, TALENTS, TENANTS, CREATURES, GUARDIANS,
  milestoneProgress, talentCost, unlockedHeroes, upgradeBlocker, upgradeCost,
  type BuildingId, type PlayerView,
} from '@shellter/shared';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import { api } from '../api';
import { name, num, t } from '../i18n';
import { adsAvailable, watchAd } from '../platform/ads';
import { sfx } from '../sound';
import { busy, haptic, liveops, meta, panel, player, refreshMe, run, screen, screenForRun, showToast, startRun, track } from '../state';
import { Btn, CostView, flyIcons, modLines, Res, Sheet, Spr, Stars, tenantText } from './kit';

function levelLine(b: BuildingId, level: number): string {
  switch (b) {
    case 'lighthouse': {
      const n = LIGHTHOUSE_STAGES[level] ?? 3;
      return n > 100 ? t('building.lighthouse.endless') : t('building.lighthouse.l', { n });
    }
    case 'garden':
      return t('building.garden.l', { n: TENANTS.filter((x) => x.unlock <= level).length });
    case 'workshop':
      return t('building.workshop.l', { n: SHELLS.filter((x) => !x.starter && x.unlock <= level).length });
    case 'corf':
      return t('building.corf.l', { n: CORF_RATE_PER_HOUR[level] ?? 0 });
    case 'school':
      return level === 0 ? '—' : t('building.school.l', { n: level });
    case 'almanac':
      return t('building.almanac.l', { n: ALMANAC_REWARD_MULT[level] ?? 1 });
    default:
      return t(`building.${b}.l${level}`);
  }
}

function canUpgrade(p: PlayerView, b: BuildingId): boolean {
  return upgradeBlocker(p.profile, b) === null;
}

export function BuildingSheet(props: { id: BuildingId }): JSX.Element | null {
  const p = player.value;
  if (!p) return null;
  const b = props.id;
  const level = p.profile.buildings[b];
  const cost = upgradeCost(p.profile, b);
  const blocker = upgradeBlocker(p.profile, b);
  const req = BUILDING_DEFS[b].requires?.[level];
  const upgrade = async (): Promise<void> => {
    const res = await meta(() => api.upgrade(b));
    if (res) {
      sfx('building_upgrade');
      haptic('success');
      track('tutorial_step', { step: `upgrade_${b}` });
    }
  };
  const collect = async (ad: boolean): Promise<void> => {
    let intent: string | undefined;
    if (ad) {
      const w = await watchAd('corf_boost', p.perks.noAds);
      if (!w.ok) return showToast(t(w.reason === 'limit' ? 'ad.limit' : 'ad.failed'));
      intent = w.intentId;
    }
    const res = await meta(() => api.corf(intent));
    if (res && res.gained > 0) {
      sfx('reward');
      flyIcons('icon/coral', document.getElementById('corf-amount'), 'res-coral', 6);
    }
  };
  return (
    <Sheet title={t(`building.${b}`)} onClose={() => (panel.value = null)} id="building-sheet">
      <div class="row" style={{ alignItems: 'flex-start' }}>
        <Spr id={`building/${b}`} size={96} />
        <div class="col grow" style={{ gap: '4px' }}>
          <div class="muted small">{t(`building.${b}.desc`)}</div>
          <div class="small">{t('common.level', { n: level })}: {levelLine(b, level)}</div>
          {cost ? <div class="small" style={{ color: 'var(--gold)' }}>{t('building.next')}: {levelLine(b, level + 1)}</div> : null}
        </div>
      </div>
      {b === 'corf' && level > 0 ? (
        <div class="item">
          <Spr id="icon/coral" size={30} />
          <div class="grow" id="corf-amount"><b>{num(p.corf.amount)}</b> / {num(p.corf.cap)}</div>
          {p.corf.amount > 0 && (adsAvailable() || p.perks.noAds) && (p.adsToday.corf_boost ?? 0) < 3 ? <Btn class="sm gold" id="corf-ad" onClick={() => void collect(true)}><Spr id="icon/ad" size={18} />x2</Btn> : null}
          <Btn class="sm ok" id="corf-collect" disabled={p.corf.amount <= 0} onClick={() => void collect(false)}>{t('common.claim')}</Btn>
        </div>
      ) : null}
      {b === 'hatchery' ? <Btn class="ghost wide" id="open-heroes" onClick={() => (panel.value = 'heroes')}>{t('home.hero')} ▸</Btn> : null}
      {b === 'school' && level > 0 ? <Btn class="ghost wide" id="open-talents" onClick={() => (panel.value = 'talents')}>{t('talents.title')} ▸</Btn> : null}
      {b === 'almanac' ? <Btn class="ghost wide" id="open-almanac" onClick={() => (panel.value = 'almanac')}>{t('almanac.title')} ▸</Btn> : null}
      {cost ? (
        <>
          {blocker === 'best_stage' ? <div class="small" style={{ color: 'var(--red)' }}>{t('building.req.best_stage', { n: req?.bestStage ?? 0 })}</div> : null}
          {blocker === 'chapter' ? <div class="small" style={{ color: 'var(--red)' }}>{t('building.req.chapter')}</div> : null}
          <Btn class="ok wide" id="upgrade-btn" disabled={blocker !== null || busy.value} onClick={() => void upgrade()}>
            {level === 0 && (b === 'corf' || b === 'school') ? t('building.build') : t('building.upgrade')} <CostView cost={cost} have={p.profile} />
          </Btn>
        </>
      ) : <div class="chip" style={{ alignSelf: 'center' }}>{t('common.max')}</div>}
    </Sheet>
  );
}

export function HeroesSheet(): JSX.Element | null {
  const p = player.value;
  if (!p) return null;
  const open = unlockedHeroes(p.profile);
  return (
    <Sheet title={t('home.hero')} onClose={() => (panel.value = null)} id="heroes-sheet">
      <div class="list scroll">
        {HEROES.map((h) => {
          const ok = open.includes(h.id);
          const sel = p.profile.heroId === h.id;
          return (
            <div class={`item ${sel ? 'done' : ''}`} key={h.id}>
              <Spr id={`crab/${h.id}/body`} size={54} style={{ filter: ok ? undefined : 'grayscale(1) brightness(0.6)' }} />
              <div class="grow">
                <b>{t(`hero.${h.id}`)}</b>
                <div class="muted tiny">{ok ? t(`hero.${h.id}.desc`) : t('hero.locked', { n: h.unlock })}</div>
              </div>
              {ok ? <Btn class={`sm ${sel ? 'ghost' : 'ok'}`} id={`hero-${h.id}`} disabled={sel} onClick={() => void meta(() => api.hero(h.id))}>{sel ? t('hero.selected') : t('hero.select')}</Btn> : <Spr id="icon/lock" size={26} />}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export function TalentsSheet(): JSX.Element | null {
  const p = player.value;
  if (!p) return null;
  return (
    <Sheet title={t('talents.title')} onClose={() => (panel.value = null)} id="talents-sheet">
      <div class="row"><Res kind="shine" value={p.profile.shine} /></div>
      <div class="list scroll">
        {TALENTS.map((tl) => {
          const lv = p.profile.talents[tl.id] ?? 0;
          const locked = p.profile.buildings.school < tl.tier;
          const cost = talentCost(p.profile, tl.id);
          const next = Math.min(lv, tl.costs.length - 1);
          const lines = tl.mods ? modLines(tl.mods[next]) : Object.entries(tl.cfg?.[next] ?? {}).map(([k, v]) => modLines({ [k]: v } as never)[0] ?? '');
          return (
            <div class={`item ${cost === null ? 'done' : ''}`} key={tl.id}>
              <div class="grow">
                <b>{t(`talent.${tl.id}`)}</b> <Stars n={lv} />
                <div class="muted tiny">{locked ? t('talent.locked', { n: tl.tier }) : lines.join(', ')}</div>
              </div>
              {cost === null ? <span class="chip tiny">{t('common.max')}</span> : (
                <Btn class="sm ok" id={`talent-${tl.id}`} disabled={locked || p.profile.shine < cost} onClick={() => void meta(() => api.talent(tl.id)).then((r) => r && sfx('level_up'))}>
                  <Spr id="icon/shine" size={16} />{cost}
                </Btn>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export function AlmanacSheet(): JSX.Element | null {
  const p = player.value;
  const tab = useSignal<'creatures' | 'tenants' | 'shells' | 'guardians' | 'milestones'>('milestones');
  if (!p) return null;
  const al = p.profile.almanac;
  const claim = async (id: string, el: EventTarget | null): Promise<void> => {
    const res = await meta(() => api.almanacClaim(id));
    if (res) {
      sfx('reward');
      flyIcons('icon/coral', el as Element, 'almanac-coral', 5);
    }
  };
  return (
    <Sheet title={t('almanac.title')} onClose={() => (panel.value = null)} id="almanac-sheet">
      <div class="row"><Res kind="coral" value={p.profile.coral} id="almanac-coral" /><Res kind="shine" value={p.profile.shine} /></div>
      <div class="tabs">
        {(['milestones', 'creatures', 'tenants', 'shells', 'guardians'] as const).map((k) => (
          <button class={tab.value === k ? 'on' : ''} key={k} onClick={() => (tab.value = k)}>{k === 'milestones' ? '🏅' : t(`almanac.${k}`)}</button>
        ))}
      </div>
      <div class="scroll" style={{ minHeight: '300px' }}>
        {tab.value === 'milestones' ? (
          <div class="list">
            {MILESTONES.map((m) => {
              const prog = milestoneProgress(al, m);
              const claimed = al.claimed.includes(m.id);
              const mult = ALMANAC_REWARD_MULT[p.profile.buildings.almanac] ?? 1;
              return (
                <div class={`item ${claimed ? 'done' : ''}`} key={m.id}>
                  <div class="grow">
                    <b class="small">{t(`milestone.${m.kind}`, { n: m.need })}</b>
                    <div class="row tiny muted">{Math.min(prog, m.need)}/{m.need} · <CostView cost={{ coral: Math.round(m.reward.coral * mult), shine: Math.round(m.reward.shine * mult) }} /></div>
                  </div>
                  {claimed ? <span class="chip tiny">✓</span> : <Btn class="sm ok" id={`ms-${m.id}`} disabled={prog < m.need} onClick={(() => void claim(m.id, document.getElementById(`ms-${m.id}`))) as () => void}>{t('common.claim')}</Btn>}
                </div>
              );
            })}
          </div>
        ) : (
          <div class="grid4">
            {tab.value === 'creatures' ? CREATURES.map((c) => {
              const n = al.creatures[c.id] ?? 0;
              return <div class={`cell ${n ? '' : 'unknown'}`} key={c.id}><Spr id={`creature/${c.id}`} size={40} /><span>{n ? name('creature', c.id) : t('almanac.unknown')}</span>{n ? <span class="muted">{t('almanac.eaten', { n })}</span> : null}</div>;
            }) : null}
            {tab.value === 'tenants' ? TENANTS.map((x) => {
              const s = al.tenants[x.id] ?? 0;
              return <div class={`cell ${s ? '' : 'unknown'}`} key={x.id} title={s ? tenantText(x.id, 1) : ''}><Spr id={`tenant/${x.id}`} size={40} /><span>{s ? name('tenant', x.id) : t('almanac.unknown')}</span>{s ? <Stars n={s} /> : null}</div>;
            }) : null}
            {tab.value === 'shells' ? SHELLS.map((x) => {
              const ok = al.shells.includes(x.id);
              return <div class={`cell ${ok ? '' : 'unknown'}`} key={x.id}><Spr id={`shell/${x.id}`} size={48} /><span>{ok ? name('shell', x.id) : t('almanac.unknown')}</span></div>;
            }) : null}
            {tab.value === 'guardians' ? GUARDIANS.map((x) => {
              const ok = al.guardians.includes(x.id);
              return <div class={`cell ${ok ? '' : 'unknown'}`} key={x.id}><Spr id={`guardian/${x.id}`} size={64} /><span>{ok ? t(`guardian.${x.id}`) : t('almanac.unknown')}</span></div>;
            }) : null}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function HomeView(): JSX.Element | null {
  const p = player.value;
  const r = run.value;
  useEffect(() => {
    void refreshMe().catch(() => undefined);
    track('screen', { name: 'home' });
  }, []);
  if (!p) return null;
  const depth = LIGHTHOUSE_STAGES[p.profile.buildings.lighthouse] ?? 3;
  const play = (): void => {
    if (r) screen.value = screenForRun(r);
    else void startRun(p.profile.heroId);
  };
  const questsReady = [...p.quests.daily, ...p.quests.weekly].filter((q) => !q.claimed && q.progress >= (QUEST_BY_ID.get(q.id)?.need ?? Infinity)).length;
  const firstTime = p.profile.stats.runs <= 1 && p.profile.buildings.lighthouse === 0;
  const lanterns = p.cosmetics.equipped.town === 'town_lanterns';
  return (
    <div class="screen pass" id="home">
      <div class="topbar">
        <Res kind="coral" value={p.profile.coral} id="res-coral" />
        <Res kind="shine" value={p.profile.shine} id="res-shine" />
        <Res kind="trophy" value={p.profile.trophies} />
        <div class="grow" />
        <button class="icon-btn" id="inbox-btn" aria-label={t('inbox.title')} onClick={() => (panel.value = 'inbox')}>✉{p.inboxUnread > 0 ? <span class="badge">{p.inboxUnread}</span> : null}</button>
        <button class="icon-btn" id="settings-btn" aria-label={t('settings.title')} onClick={() => (panel.value = 'settings')}>⚙</button>
      </div>
      <div class="col center" style={{ marginTop: '8px', gap: '2px' }}>
        <div class="title" style={{ fontSize: '26px' }}>{t('app.name')}</div>
        <div class="muted small shadow-text">{p.cosmetics.equipped.title ? `«${t(`cosmetic.${p.cosmetics.equipped.title}`)}» ` : ''}{p.name} · {p.profile.stats.bestStage > 0 ? t('home.best', { n: p.profile.stats.bestStage }) : t('app.tagline')}</div>
      </div>
      {firstTime ? <div class="hint shadow-text" style={{ marginTop: '10px', fontSize: '14px' }} id="home-tut">{t('tut.town')}</div> : null}
      <div class="grow" />
      {liveops.value?.event ? (
        <button class="chip" style={{ alignSelf: 'center', marginBottom: '8px' }} id="event-banner" onClick={() => (panel.value = 'events')}>
          🌊 {liveops.value.event.config.title[p.lang]}
        </button>
      ) : null}
      <div class="town" id="town" style={lanterns ? { filter: 'drop-shadow(0 0 10px rgba(255, 220, 120, 0.55))' } : undefined}>
        {BUILDINGS.map((b) => {
          const lv = p.profile.buildings[b];
          return (
            <button class={`bld ${lv === 0 && (b === 'corf' || b === 'school') ? 'locked' : ''}`} key={b} id={`bld-${b}`} onClick={() => { sfx('ui_open'); panel.value = { building: b }; }}>
              <span class="lv">{lv}</span>
              {canUpgrade(p, b) ? <span class="up">↑</span> : b === 'corf' && p.corf.full ? <span class="up" style={{ background: 'var(--gold)' }}>!</span> : null}
              <Spr id={`building/${b}`} size={70} />
              <span class="nm">{t(`building.${b}`)}</span>
            </button>
          );
        })}
      </div>
      <div class="row between" style={{ margin: '8px 0' }}>
        <button class="chip" id="hero-chip" onClick={() => (panel.value = 'heroes')}><Spr id={`crab/${p.profile.heroId}/body`} size={26} />{t(`hero.${p.profile.heroId}`)}</button>
        <span class="chip tiny">{depth > 100 ? t('home.endless') : t('home.depth', { n: depth })}</span>
      </div>
      <div class="nav">
        <button id="nav-quests" onClick={() => (panel.value = 'quests')}><span class="em">📜</span>{t('nav.quests')}{questsReady > 0 ? <span class="badge">{questsReady}</span> : null}</button>
        <button id="nav-events" onClick={() => (panel.value = 'events')}><span class="em">🐙</span>{t('nav.events')}</button>
        <button class="play" id="play-btn" disabled={busy.value} onClick={() => { sfx('ui_open'); play(); }}>{r ? t('home.continue') : t('home.play')}</button>
        <button id="nav-almanac" onClick={() => (panel.value = 'almanac')}><span class="em">📖</span>{t('almanac.title').split(' ')[0]}</button>
        <button id="nav-shop" onClick={() => (panel.value = 'shop')}><span class="em">🛍</span>{t('nav.shop')}</button>
      </div>
    </div>
  );
}
