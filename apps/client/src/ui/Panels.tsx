import { useSignal } from '@preact/signals';
import {
  COSMETICS, DAILY_CHEST_REWARD, DIETS, KRAKEN_ATTACKS_PER_DAY, LEAGUES, PASS_LEVELS, PASS_REWARDS, PASS_XP_PER_LEVEL, PRODUCT_BY_ID, QUEST_BY_ID, BAL,
  type InboxItem, type QuestProgress, type ShopView,
} from '@shellter/shared';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { api } from '../api';
import { duration, lang, local, num, t } from '../i18n';
import { adsAvailable, watchAd } from '../platform/ads';
import { platformKind, tg } from '../platform/telegram';
import { sfx } from '../sound';
import { applyAuth, battle, busy, ended, errorText, isTelegram, liveops, meta, panel, player, refreshMe, run, screen, setLang, setSettings, settings, showToast, track } from '../state';
import { Btn, CostView, flyIcons, Res, Sheet, Spr } from './kit';

const close = (): void => {
  panel.value = null;
};

// --- Quests and season pass ------------------------------------------------------------------------

function questText(id: string): string {
  const def = QUEST_BY_ID.get(id);
  if (!def) return id;
  const diet = DIETS.find((d) => def.metric === `eat_${d}`);
  if (diet) return t('quest.eat_diet', { diet: t(`diet.${diet}`).toLowerCase(), n: def.need });
  return t(`quest.${def.metric}`, { n: def.need });
}

function QuestRow(props: { q: QuestProgress }): JSX.Element | null {
  const def = QUEST_BY_ID.get(props.q.id);
  if (!def) return null;
  const done = props.q.progress >= def.need;
  return (
    <div class={`item ${props.q.claimed ? 'done' : ''}`}>
      <div class="grow">
        <b class="small">{questText(props.q.id)}</b>
        <div class="row tiny muted">{Math.min(props.q.progress, def.need)}/{def.need} · <CostView cost={def.reward} /></div>
      </div>
      {props.q.claimed ? <span class="chip tiny">✓</span> : (
        <Btn class="sm ok" id={`quest-${props.q.id}`} disabled={!done} onClick={() => void meta(() => api.questClaim(props.q.id)).then((r) => { if (r) { sfx('quest_done'); flyIcons('icon/coral', document.getElementById(`quest-${props.q.id}`), 'quests-coral', 5); } })}>{t('common.claim')}</Btn>
      )}
    </div>
  );
}

export function QuestsSheet(): JSX.Element | null {
  const p = player.value;
  const tab = useSignal<'quests' | 'pass'>('quests');
  if (!p) return null;
  const level = Math.min(PASS_LEVELS, Math.floor(p.pass.xp / PASS_XP_PER_LEVEL));
  return (
    <Sheet title={t('quests.title')} onClose={close} id="quests-sheet">
      <div class="row"><Res kind="coral" value={p.profile.coral} id="quests-coral" /><Res kind="shine" value={p.profile.shine} /></div>
      <div class="tabs">
        <button class={tab.value === 'quests' ? 'on' : ''} onClick={() => (tab.value = 'quests')}>{t('quests.title')}</button>
        <button class={tab.value === 'pass' ? 'on' : ''} id="tab-pass" onClick={() => (tab.value = 'pass')}>{t('quests.pass')} · {level}</button>
      </div>
      <div class="scroll list" style={{ minHeight: '320px' }}>
        {tab.value === 'quests' ? (
          <>
            <div class="h2">{t('quests.daily')}</div>
            {p.quests.daily.map((q) => <QuestRow q={q} key={q.id} />)}
            <div class="h2">{t('quests.weekly')}</div>
            {p.quests.weekly.map((q) => <QuestRow q={q} key={q.id} />)}
          </>
        ) : (
          <>
            <div class="row between small"><span>{t('quests.pass.level', { n: level })}</span><span class="muted">{p.pass.xp % PASS_XP_PER_LEVEL}/{PASS_XP_PER_LEVEL}</span></div>
            {!p.pass.premium ? <Btn class="gold sm" id="pass-buy" onClick={() => (panel.value = 'shop')}>{t('quests.pass.buy')}</Btn> : null}
            {PASS_REWARDS.map((r) => {
              const open = level >= r.level;
              const fc = p.pass.claimedFree.includes(r.level);
              const pc = p.pass.claimedPremium.includes(r.level);
              return (
                <div class="item" key={r.level} style={{ opacity: open ? 1 : 0.55 }}>
                  <b style={{ width: '22px' }}>{r.level}</b>
                  <div class="grow col" style={{ gap: '3px' }}>
                    <div class="row between tiny"><CostView cost={r.free} />{fc ? '✓' : <Btn class="sm ok" id={`pass-free-${r.level}`} disabled={!open} onClick={() => void meta(() => api.passClaim(r.level, 'free')).then((x) => x && sfx('reward'))}>{t('common.claim')}</Btn>}</div>
                    <div class="row between tiny" style={{ color: 'var(--gold)' }}>
                      <span class="row">★ {r.premium.cosmetic ? t(`cosmetic.${r.premium.cosmetic}`) : <CostView cost={{ coral: r.premium.coral ?? 0, shine: r.premium.shine ?? 0 }} />}</span>
                      {pc ? '✓' : <Btn class="sm gold" disabled={!open || !p.pass.premium} onClick={() => void meta(() => api.passClaim(r.level, 'premium')).then((x) => x && sfx('reward'))}>{p.pass.premium ? t('common.claim') : '🔒'}</Btn>}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </Sheet>
  );
}

// --- Events, Kraken, league ------------------------------------------------------------------------

export function EventsSheet(): JSX.Element | null {
  const p = player.value;
  const tab = useSignal<'event' | 'kraken' | 'league'>('event');
  useEffect(() => {
    api.liveops().then((l) => (liveops.value = l)).catch(() => undefined);
  }, []);
  const l = liveops.value;
  if (!p) return null;
  const now = p.serverTime;
  const attack = async (): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    try {
      const res = await api.krakenAttack();
      player.value = res.player;
      if (liveops.value) liveops.value = { ...liveops.value, kraken: res.kraken };
      const base = run.value ?? ended.value?.last;
      // The fight is replayed with the saved build; the run view is only needed for cosmetics.
      const me = { ...(base ?? ({} as never)), cfg: { ...(base?.cfg ?? ({ heroId: res.build.heroId, extra: res.build.extra ?? {} } as never)), heroId: res.build.heroId, extra: res.build.extra ?? {} }, size: res.build.size, genes: res.build.genes, mutations: res.build.mutations, shell: res.build.shell, slots: res.build.slots };
      battle.value = { result: res.result, enemy: { kind: 'guardian', id: 'kraken', hpMult: 1, atkMult: 1 }, won: true, stage: 9, me: me as never, kraken: true };
      panel.value = null;
      screen.value = 'battle';
      track('screen', { name: 'kraken' });
    } catch (e) {
      showToast(errorText(e));
    } finally {
      busy.value = false;
    }
  };
  return (
    <Sheet title={t('events.title')} onClose={close} id="events-sheet">
      <div class="tabs">
        <button class={tab.value === 'event' ? 'on' : ''} onClick={() => (tab.value = 'event')}>{t('nav.events')}</button>
        <button class={tab.value === 'kraken' ? 'on' : ''} id="tab-kraken" onClick={() => (tab.value = 'kraken')}>{t('kraken.title')}</button>
        <button class={tab.value === 'league' ? 'on' : ''} id="tab-league" onClick={() => (tab.value = 'league')}>{t('league.title')}</button>
      </div>
      <div class="scroll list" style={{ minHeight: '330px' }}>
        {tab.value === 'event' ? (
          l?.event ? (
            <>
              <div class="panel light col">
                <div class="h2">{local(l.event.config.title)}</div>
                <div class="muted small">{local(l.event.config.description)}</div>
                <div class="row between small"><span>{t('events.score', { n: num(l.event.myScore) })}{l.event.myRank ? ` · ${t('events.rank', { n: l.event.myRank })}` : ''}</span><span class="chip tiny">{t('events.ends', { t: duration(l.event.config.endsAt - now) })}</span></div>
              </div>
              <div class="h2">{t('events.rewards')}</div>
              {l.event.config.rankRewards.map((r, i) => {
                const from = (l.event?.config.rankRewards[i - 1]?.upTo ?? 0) + 1;
                return <div class="item small" key={i}><span class="grow">{from === r.upTo ? t('events.place1', { a: from }) : t('events.place', { a: from, b: r.upTo >= 100000 ? '∞' : r.upTo })}</span><CostView cost={r.reward} />{r.cosmetic ? <span class="chip tiny">{t(`cosmetic.${r.cosmetic}`)}</span> : null}</div>;
              })}
              <div class="h2">{t('events.top')}</div>
              {l.event.top.length === 0 ? <div class="muted small">{t('league.empty')}</div> : l.event.top.map((x, i) => <div class="item small" key={i}><b style={{ width: '24px' }}>{i + 1}</b><span class="grow">{x.name}</span>{num(x.score)}</div>)}
            </>
          ) : <div class="muted center" style={{ padding: '30px 0' }}>{t('events.none')}</div>
        ) : null}
        {tab.value === 'kraken' ? (
          l?.kraken ? (
            <>
              <div class="panel light col center">
                <Spr id="guardian/kraken" size={120} />
                <div class="muted small">{t('kraken.desc')}</div>
                <div class="bar" style={{ width: '100%', height: '22px' }}><i class="red" style={{ width: `${(l.kraken.hpLeft / l.kraken.hpMax) * 100}%` }} /><span>{num(l.kraken.hpLeft)} / {num(l.kraken.hpMax)}</span></div>
                <div class="row between small" style={{ width: '100%' }}><span>{t('kraken.dealt', { n: num(l.kraken.myDamage) })}</span><span class="chip tiny">{t('events.ends', { t: duration(l.kraken.endsAt - now) })}</span></div>
                <Btn class="go wide" id="kraken-attack" disabled={l.kraken.attacksLeft <= 0 || busy.value || l.kraken.hpLeft <= 0} onClick={() => void attack()}>
                  {l.kraken.attacksLeft > 0 ? t('kraken.attack', { n: `${l.kraken.attacksLeft}/${KRAKEN_ATTACKS_PER_DAY}` }) : t('kraken.noattacks')}
                </Btn>
                {p.profile.stats.runs === 0 ? <div class="muted tiny">{t('kraken.nobuild')}</div> : null}
              </div>
              {l.kraken.thresholds.map((th) => (
                <div class={`item small ${th.claimed ? 'done' : ''}`} key={th.pct}>
                  <b style={{ width: '44px' }}>{th.pct}%</b><span class="grow"><CostView cost={th.reward} /></span>
                  {th.claimed ? '✓' : <Btn class="sm ok" id={`kraken-claim-${th.pct}`} disabled={!th.reached || l.kraken!.myDamage <= 0} onClick={() => void meta(() => api.krakenClaim(th.pct)).then((r) => { if (r) { sfx('reward'); void api.liveops().then((x) => (liveops.value = x)); } })}>{t('common.claim')}</Btn>}
                </div>
              ))}
            </>
          ) : <div class="muted center" style={{ padding: '30px 0' }}>{t('events.none')}</div>
        ) : null}
        {tab.value === 'league' && l ? (
          <>
            <div class="panel light col">
              <div class="row between"><span class="h2">{t(`league.${l.league.league}`)}</span><Res kind="trophy" value={l.league.trophies} /></div>
              <div class="muted small">{t('league.desc')}</div>
              <div class="row wrap" style={{ gap: '4px' }}>{LEAGUES.map((x) => <span class="chip tiny" key={x.id} style={{ opacity: x.id === l.league.league ? 1 : 0.5 }}>{t(`league.${x.id}`)} {x.min}+</span>)}</div>
              {l.league.season ? <div class="tiny muted">{t('league.season', { t: duration(l.league.season.endsAt - now) })}{l.league.myRank ? ` · ${t('events.rank', { n: l.league.myRank })}` : ''}</div> : null}
            </div>
            {l.league.top.length === 0 ? <div class="muted small center">{t('league.empty')}</div> : l.league.top.map((x, i) => <div class="item small" key={i}><b style={{ width: '24px' }}>{i + 1}</b><span class="grow">{x.name}</span><Spr id="icon/trophy" size={16} />{num(x.trophies)}</div>)}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

// --- Shop ------------------------------------------------------------------------------------------

export function ShopSheet(): JSX.Element | null {
  const p = player.value;
  const view = useSignal<ShopView | null>(null);
  const waiting = useSignal<string | null>(null);
  const load = (): void => void api.shop().then((v) => (view.value = v)).catch(() => undefined);
  useEffect(() => {
    load();
    track('purchase_open');
  }, []);
  if (!p) return null;
  const poll = async (orderId: string): Promise<void> => {
    for (let i = 0; i < 40; i++) {
      try {
        if ((await api.order(orderId)).status === 'paid') {
          await refreshMe();
          load();
          waiting.value = null;
          sfx('reward');
          return showToast(t('shop.paid'));
        }
      } catch {
        /* keep waiting */
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    waiting.value = null;
  };
  const buy = async (productId: string): Promise<void> => {
    if (waiting.value) return;
    waiting.value = productId;
    try {
      const inv = await api.invoice(productId);
      const app = tg();
      if (app) {
        // Inside Telegram the invoice opens natively; the goods arrive through the bot's webhook.
        app.openInvoice(inv.url, (status) => {
          if (status === 'paid') void poll(inv.orderId);
          else {
            waiting.value = null;
            showToast(t('shop.cancelled'));
          }
        });
      } else {
        // On the website the same invoice link opens in Telegram; we wait for the server to see the payment.
        window.open(inv.url, '_blank', 'noopener');
        showToast(t('shop.open.tg'));
        void poll(inv.orderId);
      }
    } catch (e) {
      waiting.value = null;
      showToast(errorText(e));
    }
  };
  const chest = async (): Promise<void> => {
    const w = await watchAd('daily_chest', p.perks.noAds);
    if (!w.ok) return showToast(t(w.reason === 'limit' ? 'ad.limit' : 'ad.failed'));
    const res = await meta(() => api.adChest(w.intentId));
    if (res) {
      sfx('reward');
      flyIcons('icon/coral', document.getElementById('chest-btn'), 'shop-coral', 6);
    }
  };
  const chestLeft = (p.adsToday.daily_chest ?? 0) < 1 && (adsAvailable() || p.perks.noAds);
  const kinds = ['crab', 'shell', 'merge', 'town', 'title'] as const;
  return (
    <Sheet title={t('shop.title')} onClose={close} id="shop-sheet">
      <div class="row"><Res kind="coral" value={p.profile.coral} id="shop-coral" /><Res kind="shine" value={p.profile.shine} /></div>
      <div class="scroll list" style={{ minHeight: '360px' }}>
        {chestLeft ? (
          <div class="item">
            <Spr id="node/chest" size={40} />
            <div class="grow"><b>{t('shop.chest')}</b><div class="row tiny muted">{t('shop.chest.desc')} · <CostView cost={DAILY_CHEST_REWARD} /></div></div>
            <Btn class="sm gold" id="chest-btn" onClick={() => void chest()}><Spr id="icon/ad" size={18} />{t('common.free')}</Btn>
          </div>
        ) : null}
        <div class="muted tiny">{t('shop.note')}</div>
        {view.value && !view.value.enabled ? <div class="small" style={{ color: 'var(--red)' }}>{t('shop.disabled')}</div> : null}
        <div class="grid2" id="products">
          {(view.value?.products ?? []).map((pr) => {
            const def = PRODUCT_BY_ID.get(pr.id);
            const cosmetic = def?.grant.type === 'cosmetic' ? def.grant.id : null;
            return (
              <button class="card" style={{ minHeight: '120px' }} key={pr.id} id={`buy-${pr.id}`} disabled={!pr.available || !view.value?.enabled || waiting.value !== null} onClick={() => void buy(pr.id)}>
                {cosmetic?.startsWith('crab_') ? <Spr id={`crab/${cosmetic}/body`} size={44} /> : cosmetic?.startsWith('shell_') ? <Spr id={`shell/paint_${cosmetic}`} size={48} /> : <span style={{ fontSize: '30px' }}>{def?.grant.type === 'resources' ? '🪸' : def?.grant.type === 'pass' ? '🎫' : def?.grant.type === 'no_ads' ? '🚫' : def?.grant.type === 'second_chance' ? '💖' : def?.grant.type === 'save_slot' ? '💾' : '✨'}</span>}
                <div class="nm">{t(`product.${pr.id}`)}</div>
                {!cosmetic ? <div class="ds">{t(`product.${pr.id}.desc`)}</div> : null}
                <span class="price">{pr.available ? <><Spr id="icon/stars" size={16} />{pr.stars}</> : pr.reason === 'owned' ? t('shop.owned') : t('shop.limit')}</span>
                {waiting.value === pr.id ? <span class="tiny muted">{t('shop.pending')}</span> : null}
              </button>
            );
          })}
        </div>
        <div class="h2">{t('shop.cosmetics')}</div>
        {kinds.map((k) => {
          const owned = COSMETICS.filter((c) => c.kind === k && p.cosmetics.owned.includes(c.id));
          if (owned.length <= (k === 'title' ? 0 : 1)) return null;
          return (
            <div class="col" key={k} style={{ gap: '4px' }}>
              <div class="tiny muted">{t(`cosmetic.kind.${k}`)}</div>
              <div class="row wrap">
                {owned.map((c) => {
                  const on = p.cosmetics.equipped[k] === c.id;
                  return <button class="chip" key={c.id} id={`equip-${c.id}`} style={{ borderColor: on ? 'var(--green)' : undefined }} onClick={() => void meta(() => api.equip(c.id))}>{on ? '✓ ' : ''}{t(`cosmetic.${c.id}`)}</button>;
                })}
              </div>
            </div>
          );
        })}
        <div class="muted tiny">{t('settings.support')}</div>
      </div>
    </Sheet>
  );
}

// --- Inbox -----------------------------------------------------------------------------------------

export function InboxSheet(): JSX.Element {
  const items = useSignal<InboxItem[] | null>(null);
  const load = (): void => void api.inbox().then((r) => (items.value = r.items)).catch(() => (items.value = []));
  useEffect(load, []);
  return (
    <Sheet title={t('inbox.title')} onClose={close} id="inbox-sheet">
      <div class="scroll list" style={{ minHeight: '240px' }}>
        {items.value?.length === 0 ? <div class="muted center" style={{ padding: '30px 0' }}>{t('inbox.empty')}</div> : null}
        {(items.value ?? []).map((it) => (
          <div class={`item ${it.claimed ? 'done' : ''}`} key={it.id}>
            <div class="grow">
              <b class="small">{local(it.title)}</b>
              <div class="muted tiny">{local(it.body)}</div>
              {it.reward ? <div class="row tiny"><CostView cost={{ coral: it.reward.coral ?? 0, shine: it.reward.shine ?? 0 }} />{it.reward.cosmetic ? <span class="chip tiny">{t(`cosmetic.${it.reward.cosmetic}`)}</span> : null}</div> : null}
            </div>
            {!it.claimed ? <Btn class="sm ok" id={`inbox-${it.id}`} onClick={() => void meta(() => api.inboxClaim(it.id)).then((r) => { if (r) { sfx('reward'); load(); } })}>{it.reward ? t('common.claim') : t('common.ok')}</Btn> : null}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// --- Settings --------------------------------------------------------------------------------------

function Toggle(props: { on: boolean; onChange: (v: boolean) => void; id?: string }): JSX.Element {
  return <button class={`toggle ${props.on ? 'on' : ''}`} id={props.id} role="switch" aria-checked={props.on} onClick={() => { sfx('ui_tap'); props.onChange(!props.on); }} />;
}

/** Official Telegram Login Widget: binds the website guest to a Telegram account (same progress in the Mini App). */
function LoginWidget({ bot }: { bot: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const w = window as unknown as { onShellterTgAuth?: (user: Record<string, string | number>) => void };
    w.onShellterTgAuth = (user) => {
      api.authWidget(user).then((res) => { applyAuth(res); panel.value = null; void refreshMe(); }).catch((e: unknown) => showToast(errorText(e)));
    };
    const el = document.createElement('script');
    el.async = true;
    el.src = 'https://telegram.org/js/telegram-widget.js?22';
    el.setAttribute('data-telegram-login', bot);
    el.setAttribute('data-size', 'large');
    el.setAttribute('data-radius', '14');
    el.setAttribute('data-request-access', 'write');
    el.setAttribute('data-onauth', 'onShellterTgAuth(user)');
    host.current?.appendChild(el);
    return () => {
      delete w.onShellterTgAuth;
    };
  }, [bot]);
  return <div ref={host} id="tg-login" class="center" />;
}

export function SettingsSheet(): JSX.Element | null {
  const p = player.value;
  const s = settings.value;
  const notify = useSignal<{ settings: Record<string, boolean>; telegram: boolean } | null>(null);
  const nameDraft = useSignal(p?.name ?? '');
  useEffect(() => {
    api.notifyGet().then((n) => (notify.value = n)).catch(() => undefined);
  }, []);
  if (!p) return null;
  const setNotify = (key: string, v: boolean): void => {
    if (!notify.value) return;
    notify.value = { ...notify.value, settings: { ...notify.value.settings, [key]: v } };
    api.notifySet({ [key]: v }).catch(() => undefined);
  };
  const invite = async (): Promise<void> => {
    const bot = import.meta.env.VITE_BOT_USERNAME as string | undefined;
    const link = bot ? `https://t.me/${bot}?startapp=ref_${p.id}` : `${location.origin}/?startapp=ref_${p.id}`;
    const app = tg();
    if (app) app.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(t('app.tagline'))}`);
    else {
      try {
        await navigator.clipboard.writeText(link);
        showToast(t('settings.copied'));
      } catch {
        showToast(link);
      }
    }
    track('share', { kind: 'invite' });
  };
  const link = async (): Promise<void> => {
    const app = tg();
    if (app?.initData) {
      const res = await api.authLink(app.initData).catch(() => null);
      if (res) location.reload();
    } else {
      const bot = import.meta.env.VITE_BOT_USERNAME as string | undefined;
      if (bot) window.open(`https://t.me/${bot}?startapp=link`, '_blank', 'noopener');
    }
  };
  const abandon = async (): Promise<void> => {
    const r = run.value;
    if (!r || !window.confirm(t('settings.abandon.confirm', { n: Math.round(BAL.defeatKeep * 100) }))) return;
    try {
      const res = await api.runAbandon(r.id);
      if (res.player) player.value = res.player;
      if (res.ended) ended.value = { ...res.ended, last: r };
      run.value = null;
      panel.value = null;
      screen.value = 'result';
    } catch (e) {
      showToast(errorText(e));
    }
  };
  return (
    <Sheet title={t('settings.title')} onClose={close} id="settings-sheet">
      <div class="scroll list">
        <div class="item"><span style={{ width: '90px' }}>{t('settings.music')}</span><input type="range" min="0" max="1" step="0.05" value={s.music} id="set-music" onInput={(e) => setSettings({ music: Number((e.target as HTMLInputElement).value) })} /></div>
        <div class="item"><span style={{ width: '90px' }}>{t('settings.sfx')}</span><input type="range" min="0" max="1" step="0.05" value={s.sfx} id="set-sfx" onInput={(e) => setSettings({ sfx: Number((e.target as HTMLInputElement).value) })} /></div>
        <div class="item between"><span>{t('settings.haptics')}</span><Toggle on={s.haptics} id="set-haptics" onChange={(v) => setSettings({ haptics: v })} /></div>
        <div class="item between"><span>{t('settings.calm')}</span><Toggle on={s.calm} id="set-calm" onChange={(v) => setSettings({ calm: v })} /></div>
        <div class="item between">
          <span>{t('settings.lang')}</span>
          <div class="tabs" style={{ width: '150px' }}>
            <button class={lang.value === 'ru' ? 'on' : ''} id="lang-ru" onClick={() => setLang('ru')}>Русский</button>
            <button class={lang.value === 'en' ? 'on' : ''} id="lang-en" onClick={() => setLang('en')}>English</button>
          </div>
        </div>
        <div class="item"><span style={{ width: '60px' }}>{t('settings.name')}</span><input type="text" maxLength={24} value={nameDraft.value} id="set-name" onInput={(e) => (nameDraft.value = (e.target as HTMLInputElement).value)} onBlur={() => nameDraft.value.trim() && nameDraft.value !== p.name && void meta(() => api.settings({ name: nameDraft.value.trim() }))} /></div>
        {notify.value?.telegram ? (
          <>
            <div class="h2">{t('settings.notify')}</div>
            {(['corf', 'events', 'kraken'] as const).map((k) => (
              <div class="item between" key={k}><span>{t(`settings.notify.${k}`)}</span><Toggle on={notify.value?.settings[k] === true && notify.value.settings.enabled !== false} id={`notify-${k}`} onChange={(v) => setNotify(k, v)} /></div>
            ))}
          </>
        ) : null}
        <div class="h2">{t('settings.account')}</div>
        {p.guest ? (
          <div class="item col" style={{ alignItems: 'stretch' }}>
            <span class="muted small">{t('settings.guest')}</span>
            {isTelegram() ? <Btn class="sm" id="link-tg" onClick={() => void link()}>{t('settings.link')}</Btn> : import.meta.env.VITE_BOT_USERNAME ? <LoginWidget bot={import.meta.env.VITE_BOT_USERNAME as string} /> : null}
          </div>
        ) : null}
        <Btn class="ghost wide" id="invite-btn" onClick={() => void invite()}>{t('settings.invite')}</Btn>
        {platformKind() !== 'web' && tg()?.addToHomeScreen ? <Btn class="ghost wide" onClick={() => tg()?.addToHomeScreen?.()}>{t('settings.homescreen')}</Btn> : null}
        {run.value ? <Btn class="ghost wide" id="abandon-btn" onClick={() => void abandon()}>{t('settings.abandon')}</Btn> : null}
        <div class="muted tiny center">{t('settings.support')} · v{__APP_VERSION__}</div>
      </div>
    </Sheet>
  );
}
