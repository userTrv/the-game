import { useSignal } from '@preact/signals';
import {
  BAL, CHAPTER_STAGES, DIETS, duelPearls, familyCounts, frontCount, guardianDef, heroDef, mutationDef, orderPrice, POOLS, ratePower, buildFighter, rerollCost, setLevel, SET_BONUSES,
  SET_THRESHOLDS, shellDef, slotCount, slotLinks, stageInfo, tenantDef, TROPHY_LOSS, TROPHY_WIN, wouldMerge, xpNeed,
  type Diet, type Enemy, type GuardianAbility, type Offer, type Pool, type PublicRun, type SlotLinks, type TenantInst,
} from '@shellter/shared';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { api } from '../api';
import { battleScene, hunt, showcase } from '../director';
import { frame } from '../gfx/assets';
import { name, num, stat, t } from '../i18n';
import { adsAvailable, watchAd } from '../platform/ads';
import { battleHud, battleSpeed, buildOfRun } from '../scenes/battle';
import { huntHud } from '../scenes/hunt';
import { sfx } from '../sound';
import { act, battle, busy, ended, haptic, lastEvents, meta, panel, player, run, screen, screenForRun, showToast, track } from '../state';
import { abilityText, Bar, Btn, DietIcon, flyIcons, Ico, LinkLine, modLines, Res, Sheet, Spr, Stars, tenantText } from './kit';

/** Hints that mention a finger have a mouse wording for desktop. */
const MOUSE = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
const MOUSE_HINTS = new Set(['hunt.hint.move', 'hunt.hint.hide', 'hunt.hint.parry']);
const DIET_STATUS: Record<string, string> = { poison: '☠\uFE0E', blind: '◌', stun: 'ϟ', weak: '▾', slow: '≈', mark: '◎' };

// --- Hunt HUD -------------------------------------------------------------------------------------

export function HuntHudView(): JSX.Element | null {
  const h = huntHud.value;
  const r = run.value;
  if (!h || !r) return null;
  const info = stageInfo(r.stage);
  const gained = DIETS.filter((d) => h.gained[d] >= 1);
  return (
    <div class="screen pass" id="hunt">
      <div class="hud-top">
        <div class="hud-left">
          <Bar value={h.hp} max={h.maxHp} shield={h.shield} kind="red" label={`${Math.ceil(h.hp)}`} style={{ height: '20px' }} />
          <Bar value={h.xp} max={1} kind="xp" label={`${t('common.level', { n: h.size })}`} />
          <div class="genes" id="hunt-genes">
            {gained.map((d) => (
              <span class="gene" key={d}>
                <DietIcon diet={d} size={16} />+{Math.floor(h.gained[d])}
              </span>
            ))}
          </div>
        </div>
        <div class="col" style={{ alignItems: 'flex-end', gap: '5px' }}>
          <div class="row" style={{ gap: '5px' }}>
            <Res kind="pearl" value={r.pearls + h.pearls} />
            <button class="icon-btn" aria-label={t('settings.title')} onClick={() => { hunt()?.setPaused(true); panel.value = 'settings'; }}><Ico id="settings" /></button>
          </div>
          <span class="chip tiny">{t('hunt.stage', { n: r.stage })} · {t(`biome.${info.biome}`)}</span>
          <div class={`danger ${h.danger >= 1 ? 'over' : ''}`} style={{ width: '120px' }} title={t('hunt.danger')}><i style={{ width: `${Math.min(1, h.danger) * 100}%` }} /></div>
          {h.dist >= 5 ? <span class="chip tiny" id="hunt-dist">{h.dist} {t('hunt.m')}</span> : null}
        </div>
      </div>
      {h.hint ? <div class="hint shadow-text" id="hunt-hint">{t(MOUSE && MOUSE_HINTS.has(h.hint) ? `${h.hint}.mouse` : h.hint)}</div> : h.danger > 0.66 && h.time % 12 < 4 ? <div class="hint shadow-text">{t('hunt.danger')}</div> : null}
      <div class="grow" />
      <div class="row center">
        <Btn class={`go big ${h.canLeave ? '' : 'ghost'}`} id="hunt-leave" disabled={!h.canLeave} onClick={() => hunt()?.leave()}>
          {h.canLeave ? `${t('hunt.leave')} ▸` : t('hunt.leave.wait')}
        </Btn>
      </div>
      {h.paused ? (
        <div class="pause-veil">
          <div class="title">{t('hunt.paused')}</div>
          <div class="muted">{t('hunt.resume')}</div>
        </div>
      ) : null}
    </div>
  );
}

// --- Camp -----------------------------------------------------------------------------------------

function offerDiets(o: Offer): Diet[] {
  if (o.type === 'tenant') return [...tenantDef(o.id).families];
  if (o.type === 'mutation') return [mutationDef(o.id).diet];
  return [];
}

function ownedCount(r: PublicRun, id: string, star: number): number {
  return r.slots.reduce((n, x) => n + (x && x.id === id && x.star === star ? 1 : 0), 0);
}

/** Progress towards a merge: filled dots are copies on the shell, the ringed one is this card. */
function MergePips(props: { have: number; need: number; full: boolean }): JSX.Element {
  return (
    <span class={`pips ${props.full ? 'full' : ''}`}>
      {Array.from({ length: props.need }).map((_, i) => <i class={i < props.have ? 'on' : i === props.have ? 'next' : ''} key={i} />)}
    </span>
  );
}

/** What a tenant on the shell does, shown in a bubble over its slot. */
function TenantTip(props: { tn: TenantInst; r: PublicRun; children?: ComponentChildren }): JSX.Element {
  const { tn, r } = props;
  const def = tenantDef(tn.id);
  const need = heroDef(r.cfg.heroId).mergeCount;
  const have = ownedCount(r, tn.id, tn.star);
  return (
    <>
      <div class="row between" style={{ gap: '6px' }}>
        <b>{name('tenant', tn.id)} <Stars n={tn.star} /></b>
        {tn.star < 3 ? <MergePips have={have} need={need} full={false} /> : null}
      </div>
      <div class="row wrap" style={{ gap: '4px' }}>
        {def.families.map((d) => <span class={`set diet-${d}`} key={d}><DietIcon diet={d} size={14} />{t(`diet.${d}`)}</span>)}
        <span class="muted tiny">{t(`camp.role.${def.role}`)}</span>
      </div>
      <div class="small">{abilityText(def.ability, tn.star)}</div>
      {def.link ? <LinkLine link={def.link} star={tn.star} heroId={r.cfg.heroId} /> : null}
      {tn.star < 3 ? <div class="muted tiny"><Stars n={tn.star + 1} /> {abilityText(def.ability, (tn.star + 1) as 2 | 3)}</div> : null}
      {props.children}
    </>
  );
}

function OfferCard(props: { offer: Offer; r: PublicRun; price?: number; sold?: boolean; onPick: () => void; id: string; foe?: { id: string; weak: readonly Diet[] } | null }): JSX.Element {
  const { offer: o, r } = props;
  const diets = offerDiets(o);
  const topGene = DIETS.reduce((a, b) => (r.genes[b] > r.genes[a] ? b : a), DIETS[0]);
  const why = diets.length > 0 && diets.includes(topGene) && r.genes[topGene] >= 4;
  const afford = props.price === undefined || r.pearls >= props.price;
  let body: JSX.Element;
  if (o.type === 'tenant') {
    const merge = wouldMerge({ ...r, seed: '' }, o.id, o.star);
    const have = ownedCount(r, o.id, o.star);
    body = (
      <>
        <Spr id={`tenant/${o.id}`} size={50} />
        <div class="nm">{name('tenant', o.id)} <Stars n={o.star} /></div>
        <div class="ds">{tenantText(o.id, o.star)}</div>
        {tenantDef(o.id).link ? <LinkLine link={tenantDef(o.id).link!} star={o.star} heroId={r.cfg.heroId} /> : null}
        {have > 0 ? <MergePips have={have} need={heroDef(r.cfg.heroId).mergeCount} full={merge} /> : null}
      </>
    );
  } else if (o.type === 'mutation') {
    const def = mutationDef(o.id);
    const cur = r.mutations[def.slot];
    body = (
      <>
        <Spr id={`icon/${def.slot}`} size={44} />
        <div class="nm">{name('mut', o.id)}</div>
        <div class="ds">{modLines(def.tiers[o.tier - 1]).join(', ')}</div>
        <div class="tiny muted">{name('slot', def.slot)} · {t('camp.tier', { n: o.tier })}{cur && cur.id !== o.id ? ` · ${t('camp.mutation.replaces', { name: name('mut', cur.id) })}` : ''}</div>
      </>
    );
  } else {
    body = (
      <>
        <Spr id="icon/heart" size={46} />
        <div class="nm">{t('camp.heal')}</div>
        <div class="ds">{t('camp.heal.desc', { n: o.pct })}</div>
      </>
    );
  }
  return (
    <button class={`card ${diets[0] ? `diet-${diets[0]}` : ''} ${props.sold ? 'taken' : ''}`} id={props.id} onClick={props.onPick} disabled={props.sold}>
      {diets[0] ? (
        <span class="tag">
          {diets.map((d) => <DietIcon diet={d} size={13} key={d} />)}
          {t(`diet.${diets[0]}`)}
        </span>
      ) : null}
      {props.foe && o.type === 'tenant' && props.foe.weak.includes(tenantDef(o.id).families[0]) ? <span class="foe"><Spr id={`guardian/${props.foe.id}`} size={22} /><Ico id="weak" size={11} /></span> : null}
      {why ? <span class="why" title={t('camp.because', { diet: t(`diet.${topGene}`) })}><DietIcon diet={topGene} size={20} /></span> : null}
      {body}
      {props.price !== undefined ? (
        <span class={`price ${afford ? '' : 'no'}`}>
          <Spr id="icon/pearl" size={16} />
          {props.sold ? t('camp.sold') : props.price}
        </span>
      ) : null}
    </button>
  );
}

/** Cell size and gap of the shell grid, px. Links are drawn in the gaps. */
const CELL = 48;
const GAP = 14;

/**
 * The shell as a grid: front row on top, back row under it. A tap opens the tenant's bubble (or names
 * the cell when something waits to be placed); dragging a tenant onto another cell moves or swaps it.
 * Neighbours that work together are joined by a glowing bridge, and while a tenant is dragged the
 * bridges show what the shell would look like if it were dropped right there.
 */
function ShellGrid(props: { r: PublicRun; open: number | null; picking: boolean; onTap: (i: number) => void; onMove: (from: number, to: number) => void; merged: number[]; tip: JSX.Element | null }): JSX.Element {
  const { r } = props;
  const n = r.slots.length;
  const cols = frontCount(n);
  const drag = useSignal<{ from: number; x: number; y: number; over: number | null } | null>(null);
  const press = useRef<{ i: number; x: number; y: number; id: number } | null>(null);
  const dragged = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const slotAt = (x: number, y: number): number | null => {
    // Whatever lies on top (the dragged tenant itself, a bubble), the cell underneath counts.
    for (const el of document.elementsFromPoint(x, y)) {
      const slot = el.closest('.slot');
      if (slot) return Number(slot.id.slice(5));
    }
    return null;
  };
  const down = (e: PointerEvent, i: number): void => {
    dragged.current = false;
    if (!r.slots[i] || props.picking) return;
    press.current = { i, x: e.clientX, y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent): void => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!drag.value && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
    dragged.current = true;
    drag.value = { from: p.i, x: e.clientX, y: e.clientY, over: slotAt(e.clientX, e.clientY) };
  };
  const up = (e: PointerEvent): void => {
    const d = drag.value;
    press.current = null;
    drag.value = null;
    if (!d) return;
    const to = slotAt(e.clientX, e.clientY);
    if (to !== null && to !== d.from) props.onMove(d.from, to);
  };
  const cancel = (): void => {
    press.current = null;
    drag.value = null;
  };
  useEffect(() => {
    // Safety net: if the release never reaches the cell (capture lost, window blurred), drop here.
    const end = (e: Event): void => {
      if (!press.current && !drag.value) return;
      if (e instanceof PointerEvent && e.type === 'pointerup') up(e);
      else cancel();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
    };
  });
  const d = drag.value;
  const held = d ? r.slots[d.from] : null;
  // While a tenant hangs over another cell the grid previews the swap.
  const swap = d && d.over !== null && d.over !== d.from ? { a: d.from, b: d.over } : null;
  const src = (i: number): number => (swap ? (i === swap.a ? swap.b : i === swap.b ? swap.a : i) : i);
  const shown = r.slots.map((_, i) => r.slots[src(i)] ?? null);
  const now: SlotLinks = slotLinks(r.slots, r.cfg.heroId);
  const links: SlotLinks = swap ? slotLinks(shown, r.cfg.heroId) : now;
  const at = (i: number): { x: number; y: number } => ({ x: (i < cols ? i : i - cols) * (CELL + GAP), y: i < cols ? 0 : CELL + GAP });
  const cell = (tn: TenantInst | null, i: number): JSX.Element => {
    const def = tn ? tenantDef(tn.id) : null;
    const row = i < cols ? 'front' : 'back';
    const from = src(i);
    const gain = swap && tn ? Math.sign(((links.power[i] ?? 1) - (now.power[from] ?? 1)) + ((now.cd[from] ?? 1) - (links.cd[i] ?? 1))) : 0;
    const pct = Math.round(((links.power[i] ?? 1) - 1) * 100);
    const fast = Math.round((1 - (links.cd[i] ?? 1)) * 100);
    const solo = links.active.some((l) => l.kind === 'solo' && l.from === i);
    const cls = `slot ${row} ${props.open === i ? 'sel' : ''} ${props.merged.includes(i) ? 'merge' : ''} ${d?.from === i && !swap ? 'lift' : ''} ${d && d.over === i && d.from !== i ? 'over' : ''} ${props.picking ? 'pick' : ''} ${gain > 0 ? 'boost' : gain < 0 ? 'drop' : ''} ${solo ? 'solo' : ''}`;
    return (
      <button
        class={cls} key={i} id={`slot-${i}`} style={{ left: `${at(i).x}px`, top: `${at(i).y}px` }}
        onPointerDown={(e) => down(e, i)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          props.onTap(i);
        }}
      >
        {tn ? <Spr id={`tenant/${tn.id}`} size={36} /> : null}
        {tn ? <Stars n={tn.star} /> : null}
        {def && def.role === row ? <span class="ok" /> : null}
        {tn && (pct > 0 || fast > 0) ? <span class="amp">{pct > 0 ? `+${pct}` : `»${fast}`}</span> : null}
      </button>
    );
  };
  const bridge = (l: SlotLinks['active'][number], k: number): JSX.Element | null => {
    if (l.kind === 'solo') return null;
    const a = at(l.from);
    const b = at(l.to);
    const horizontal = a.y === b.y;
    const x = horizontal ? Math.min(a.x, b.x) + CELL : a.x + CELL / 2;
    const y = horizontal ? a.y + CELL / 2 : Math.min(a.y, b.y) + CELL;
    // An aura flows from its owner to the neighbour, a bond the other way: the bead shows who gets stronger.
    const to = l.kind === 'aura' ? l.to : l.from;
    const other = l.kind === 'aura' ? l.from : l.to;
    const fwd = horizontal ? at(to).x > at(other).x : at(to).y > at(other).y;
    return <i class={`bridge diet-${l.family} ${horizontal ? 'h' : 'v'} ${fwd ? 'fwd' : 'rev'} ${l.stat}`} key={`${k}-${l.from}-${l.to}`} style={{ left: `${x}px`, top: `${y}px` }} />;
  };
  // The bubble hangs over its cell and stays inside the panel.
  // The ghost is placed inside the grid: the panel's blur makes it the origin for fixed children too.
  const box = wrap.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0 };
  // Screen pixels to layout pixels, in case an ancestor is scaled (screen transitions).
  const zoom = box.width > 0 && wrap.current ? wrap.current.offsetWidth / box.width : 1;
  const W = wrap.current?.clientWidth ?? 320;
  const gw = cols * CELL + (cols - 1) * GAP;
  const ox = (W - gw) / 2;
  const tw = Math.min(300, W);
  const open = props.open;
  const cx = open !== null ? ox + at(open).x + CELL / 2 : W / 2;
  const left = Math.max(0, Math.min(W - tw, cx - tw / 2));
  const rows = n > cols ? 2 : 1;
  return (
    <div class="slots-wrap" ref={wrap}>
      <div class={`grid ${d ? 'dragging' : ''}`} style={{ width: `${gw}px`, height: `${rows * CELL + (rows - 1) * GAP}px` }}>
        <span class="rowmark front" style={{ top: `${CELL / 2}px` }}><Spr id="icon/front" size={13} /></span>
        {rows > 1 ? <span class="rowmark back" style={{ top: `${CELL + GAP + CELL / 2}px` }}><Spr id="icon/back" size={13} /></span> : null}
        {links.active.map(bridge)}
        {shown.map(cell)}
      </div>
      {props.tip && open !== null ? <div class="tip col" id="tenant-tip" style={{ left: `${left}px`, width: `${tw}px`, bottom: `${rows * CELL + (rows - 1) * GAP - at(open).y + 10}px`, '--ax': `${cx - left}px` }}>{props.tip}</div> : null}
      {d && held ? <span class="drag-ghost" style={{ left: `${(d.x - box.left) * zoom}px`, top: `${(d.y - box.top) * zoom}px` }}><Spr id={`tenant/${held.id}`} size={46} /></span> : null}
    </div>
  );
}

function GeneBars(props: { r: PublicRun; up: Diet[] }): JSX.Element {
  const { r } = props;
  return (
    <div class="genebars" title={t('camp.genes')}>
      {DIETS.map((d) => {
        const g = Math.floor(r.genes[d]);
        const next = BAL.geneThresholds.find((x) => g < x) ?? BAL.geneThresholds[BAL.geneThresholds.length - 1]!;
        return (
          <div class={`genebar diet-${d} ${props.up.includes(d) ? 'up' : ''}`} key={d}>
            <span class="row" style={{ gap: '2px' }}><DietIcon diet={d} size={16} />{g}</span>
            <div class="tube"><i style={{ width: `${Math.min(100, (g / next) * 100)}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function SetChips(props: { r: PublicRun }): JSX.Element | null {
  const counts = familyCounts(props.r.slots);
  const shown = DIETS.filter((d) => counts[d] > 0);
  if (shown.length === 0) return null;
  return (
    <div class="sets">
      {shown.map((d) => {
        const lv = setLevel(counts[d]);
        const next = SET_THRESHOLDS[Math.min(2, lv + 1)]!;
        return (
          <span class={`set diet-${d} ${lv < 0 ? 'off' : ''}`} key={d} title={lv >= 0 ? modLines(SET_BONUSES[d][lv]).join(', ') : ''}>
            <DietIcon diet={d} size={14} />
            {counts[d]}/{lv >= 2 ? 6 : next}
          </span>
        );
      })}
    </div>
  );
}

/** The guardian waiting further down: who it is, how many pools away, what hurts it and what does not. */
function GuardianAhead(props: { r: PublicRun; after: number; open: boolean; onToggle: () => void }): JSX.Element | null {
  const { r, after } = props;
  let stage = after + 1;
  while (stage <= r.cfg.maxStage && stageInfo(stage).kind !== 'guardian') stage += 1;
  if (stage > r.cfg.maxStage) return null;
  const info = stageInfo(stage);
  if (!info.guardianId) return null;
  const def = guardianDef(info.guardianId);
  const pools = stage - after - 1;
  return (
    <div class="ahead">
      <button class={`orb foe ${pools === 0 ? 'near' : ''}`} id="guardian-ahead" aria-label={t(`guardian.${def.id}`)} onClick={props.onToggle}>
        <Spr id={`guardian/${def.id}`} size={50} />
      </button>
      <div class="marks">
        {def.weak.map((d) => <span class="mark wk" key={d}><DietIcon diet={d} size={17} /><Ico id="weak" size={10} /></span>)}
        {def.resist.map((d) => <span class="mark rs" key={d}><DietIcon diet={d} size={17} /><Ico id="resist" size={10} /></span>)}
      </div>
      <div class="steps">{Array.from({ length: pools }).map((_, i) => <i key={i} />)}</div>
      {props.open ? (
        <div class="tip below col" id="guardian-tip">
          <b>{info.loop > 0 ? t('guardian.ancient', { name: t(`guardian.${def.id}`) }) : t(`guardian.${def.id}`)}</b>
          <div class="row wrap" style={{ gap: '8px' }}>
            {def.weak.map((d) => <span class="row" style={{ gap: '3px', color: 'var(--accent)' }} key={d}><DietIcon diet={d} size={16} />×{BAL.weakMult}</span>)}
            {def.resist.map((d) => <span class="row muted" style={{ gap: '3px' }} key={d}><DietIcon diet={d} size={16} />×{BAL.resistMult}</span>)}
          </div>
          {def.abilities.map((a, i) => (
            <div class="row small" style={{ gap: '4px', alignItems: 'flex-start' }} key={i}><DietIcon diet={a.family} size={15} /><span>{guardianAbilityText(a)}</span></div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function guardianAbilityText(a: GuardianAbility): string {
  const r1 = (v: number): string => String(Math.round(v * 10) / 10);
  let s = stat(`ab.${a.kind}`, { v: r1(a.v) });
  if (a.also) s += ` ${stat('ab.also', {})} ${stat(`ab.${a.also.kind}`, { v: r1(a.also.v) }).toLowerCase()}`;
  return a.kind === 'burst' ? s : `${s}, ${stat('ab.cd', { v: r1(a.cd) })}`;
}

/** Another player's crab swimming by the camp. One spar per camp: pearls and cups, no lives at stake. */
function Rival(props: { r: PublicRun; power: number; open: boolean; onToggle: () => void; onDuel: () => void }): JSX.Element | null {
  const rival = props.r.camp?.rival;
  if (!rival || props.r.camp?.dueled) return null;
  const b = rival.build;
  const skin = b.skin?.crab && frame(`crab/${b.skin.crab}/body`) ? b.skin.crab : b.heroId;
  const edge = rival.power > props.power * 1.12 ? 'hard' : rival.power < props.power * 0.88 ? 'easy' : '';
  return (
    <div class="ahead left">
      <button class="orb rival" id="rival" aria-label={rival.name} onClick={props.onToggle}>
        <Spr id={`shell/${b.shell.id}`} size={40} class="sh" />
        <Spr id={`crab/${skin}/body`} size={34} class="cr" />
      </button>
      <div class={`marks pw ${edge}`}><Spr id="icon/power" size={14} />{num(rival.power)}</div>
      <div class="who">{rival.name}</div>
      {props.open ? (
        <div class="tip below col" id="rival-tip">
          <div class="row wrap" style={{ gap: '3px' }}>
            {b.slots.map((tn, i) => (tn ? <span class="mini" key={i}><Spr id={`tenant/${tn.id}`} size={26} /><Stars n={tn.star} /></span> : null))}
          </div>
          <div class="row between" style={{ gap: '8px' }}>
            <span class="row small" style={{ gap: '6px' }}>
              <span class="row" style={{ gap: '2px' }}><Spr id="icon/pearl" size={15} />+{duelPearls(props.r.camp?.after ?? 1)}</span>
              <span class="row" style={{ gap: '2px' }}><Spr id="icon/trophy" size={15} />+{TROPHY_WIN}<span class="muted">/−{TROPHY_LOSS}</span></span>
            </span>
            <Btn class="sm go" id="duel-btn" onClick={props.onDuel}><Ico id="duel" size={18} /></Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** How wild a current is, 1..3. */
function poolRisk(p: Pool): number {
  const def = POOLS[p.kind];
  if (def.danger < 1) return 1;
  return def.danger > 1 || def.stalkerFrom < 1 ? 3 : 2;
}

/** A current to dive into: what it is rich in and how dangerous it gets. */
function Current(props: { pool: Pool; index: number; disabled: boolean; onPick: () => void }): JSX.Element {
  const { pool } = props;
  const def = POOLS[pool.kind];
  const risk = poolRisk(pool);
  return (
    <button class={`current k-${pool.kind} ${pool.diet ? `diet-${pool.diet}` : ''}`} id={`path-${props.index}`} disabled={props.disabled} onClick={() => { sfx('ui_tap'); haptic('medium'); props.onPick(); }}>
      <span class="bub">
        {pool.kind === 'pearl' ? <Spr id="icon/pearl" size={26} /> : pool.kind === 'swarm' && pool.diet ? <DietIcon diet={pool.diet} size={26} /> : <Ico id={pool.kind === 'nest' ? 'nest' : pool.kind === 'dark' ? 'dark' : 'calm'} size={24} />}
        {def.oyster > 1 ? <em>×{def.oyster}</em> : def.swarmWeight > 1 ? <em>×{def.swarmWeight}</em> : def.xp !== 1 ? <em class={def.xp > 1 ? 'up' : 'dn'}>{def.xp > 1 ? '▲' : '▼'}</em> : null}
      </span>
      <span class="nm">{t(`pool.${pool.kind}`)}</span>
      <span class="risk">{[1, 2, 3].map((i) => <i class={i <= risk ? 'on' : ''} key={i} />)}</span>
    </button>
  );
}

function enemyName(e: Enemy): string {
  if (e.kind === 'ghost') return e.name;
  const base = t(`guardian.${e.id}`);
  return e.hpMult > 1 ? t('guardian.ancient', { name: base }) : base;
}

export function CampView(): JSX.Element | null {
  const r = run.value;
  const p = player.value;
  const selected = useSignal<number | null>(null);
  const pending = useSignal<{ kind: 'offer' | 'buy' | 'order'; index: number } | null>(null);
  const confirmCarry = useSignal(false);
  const bubble = useSignal<'guardian' | 'rival' | null>(null);
  const merged = useSignal<number[]>([]);
  const tut = useSignal<string | null>(null);
  const evs = lastEvents.value;

  useEffect(() => {
    // Turn reducer events into celebration: merges, new shell, growth.
    const merges = evs.filter((e) => e.type === 'merge');
    if (merges.length > 0) {
      merged.value = merges.map((m) => (m.type === 'merge' ? m.slot : -1));
      const top = merges[merges.length - 1];
      const rainbow = player.value?.cosmetics.equipped.merge === 'merge_rainbow';
      setTimeout(() => {
        if (top && top.type === 'merge') showcase()?.celebrate(top.slot, top.star === 3 ? 0xffe066 : 0xcfe8ff, rainbow);
        sfx(merges.some((m) => m.type === 'merge' && m.star === 3) ? 'merge_3' : 'merge_2');
        haptic('success');
      }, 120);
      setTimeout(() => (merged.value = []), 900);
    } else if (evs.some((e) => e.type === 'shell')) {
      showcase()?.celebrate(null, 0xffd9b0);
      sfx('shell_swap');
    } else if (evs.some((e) => e.type === 'mutation')) {
      showcase()?.celebrate(null, 0xc38bff);
      sfx('mutation');
    } else if (evs.some((e) => e.type === 'tenant_added')) sfx('card_pick');
  }, [evs]);

  useEffect(() => {
    if (!r?.cfg.tutorial || !r.camp) return;
    if (r.camp.after === 1 && !r.camp.offerTaken) tut.value = 'tut.camp1';
    else if (r.camp.after === 2 && !r.camp.offerTaken) tut.value = 'tut.camp2';
    else if (r.camp.after === 2 && r.camp.offerTaken) tut.value = 'tut.guardian';
    else tut.value = null;
  }, [r?.camp?.after, r?.camp?.offerTaken]);

  useEffect(() => {
    // The tenant bubble closes on a tap anywhere else.
    const close = (e: PointerEvent): void => {
      const el = e.target as Element | null;
      if (selected.value !== null && !el?.closest?.('.tip, .slot')) selected.value = null;
      if (bubble.value !== null && !el?.closest?.('.ahead')) bubble.value = null;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  if (!r || !p) return null;
  const camp = r.camp;
  const fighter = buildFighter(buildOfRun(r));
  const power = ratePower(fighter);
  const after = camp?.after ?? r.stage;
  const next = after + 1;
  const atMax = next > r.cfg.maxStage;
  const nextInfo = atMax ? null : stageInfo(next);
  const waitingBattle = r.phase === 'battle' && r.battle !== null;
  const paths = camp && !waitingBattle && !atMax && nextInfo?.kind === 'hunt' && camp.paths && camp.paths.length > 0 ? camp.paths : null;
  // The guardian whose weakness the cards point at.
  let foeStage = next;
  while (foeStage <= r.cfg.maxStage && stageInfo(foeStage).kind !== 'guardian') foeStage += 1;
  const foeId = foeStage <= r.cfg.maxStage ? stageInfo(foeStage).guardianId : undefined;
  const foe = foeId ? { id: foeId, weak: guardianDef(foeId).weak } : null;
  const up = evs.filter((e) => e.type === 'gene_threshold').map((e) => (e.type === 'gene_threshold' ? e.diet : 'sting'));

  const needsSlot = (o: Offer): boolean => o.type === 'tenant' && !r.slots.includes(null) && !wouldMerge({ ...r, seed: '' }, o.id, o.star);
  const take = async (kind: 'offer' | 'buy' | 'order', index: number, slot?: number): Promise<void> => {
    const base = kind === 'offer' ? { type: 'pick_offer' as const, index } : kind === 'buy' ? { type: 'buy' as const, index } : { type: 'order' as const, of: index };
    const res = await act(slot !== undefined ? { ...base, slot } : base);
    pending.value = null;
    if (res && kind !== 'offer') sfx('buy');
    track('tutorial_step', { step: `camp_${kind}_${after}` });
  };
  /** Cards say what they do, so a tap takes or buys at once; only a full shell asks which tenant to replace. */
  const pick = (kind: 'offer' | 'buy', index: number, o: Offer, price?: number): void => {
    if (busy.value) return;
    selected.value = null;
    if (price !== undefined && r.pearls < price) return showToast(t('camp.nopearls'));
    if (needsSlot(o)) {
      pending.value = { kind, index };
      return;
    }
    pending.value = null;
    void take(kind, index);
  };
  const order = (i: number): void => {
    const src = r.slots[i];
    if (!src || busy.value) return;
    selected.value = null;
    if (r.pearls < orderPrice(src)) return showToast(t('camp.nopearls'));
    if (needsSlot({ type: 'tenant', id: src.id, star: 1 })) {
      pending.value = { kind: 'order', index: i };
      return;
    }
    void take('order', i);
  };
  const tapSlot = (i: number): void => {
    if (pending.value) {
      // The tenant being copied cannot be the one evicted.
      if (pending.value.kind === 'order' && pending.value.index === i) return;
      return void take(pending.value.kind, pending.value.index, i);
    }
    selected.value = selected.value === i || !r.slots[i] ? null : i;
  };
  const moveSlot = (from: number, to: number): void => {
    selected.value = null;
    void act({ type: 'move', from, to });
  };
  const duel = async (): Promise<void> => {
    bubble.value = null;
    const res = await act({ type: 'duel' });
    if (res) screen.value = 'battle';
  };
  const go = async (path?: number): Promise<void> => {
    if (waitingBattle) {
      const res = await act({ type: 'battle' });
      if (res) screen.value = 'battle';
      return;
    }
    const res = await act(path !== undefined ? { type: 'descend', path } : { type: 'descend' });
    if (!res) return;
    const now = run.value;
    if (now?.phase === 'battle') {
      const b = await act({ type: 'battle' });
      if (b) screen.value = 'battle';
    } else screen.value = screenForRun(now);
  };
  const carry = async (): Promise<void> => {
    confirmCarry.value = false;
    const res = await act({ type: 'carry_out' });
    if (res) screen.value = 'result';
  };
  const reroll = async (ad: boolean): Promise<void> => {
    if (ad) {
      const w = await watchAd('reroll', p.perks.noAds);
      if (!w.ok) return showToast(t(w.reason === 'limit' ? 'ad.limit' : 'ad.failed'));
      await act({ type: 'reroll', adIntentId: w.intentId });
    } else await act({ type: 'reroll' });
    sfx('reroll');
  };

  const sel = selected.value !== null ? r.slots[selected.value] : null;
  const maxHp = fighter.maxHp;

  return (
    <div class="screen pass" id="camp">
      <div class="row between">
        <span class="chip">{t('hunt.stage', { n: after })}</span>
        <div class="row" style={{ gap: '5px' }}>
          <Res kind="pearl" value={r.pearls} id="camp-pearls" />
          <span class="chip" title={t('camp.lives')}>{Array.from({ length: Math.max(r.lives, 0) }).map((_, i) => <Spr id="icon/life" size={18} key={i} />)}</span>
          <button class="icon-btn" aria-label={t('settings.title')} onClick={() => (panel.value = 'settings')}><Ico id="settings" /></button>
        </div>
      </div>
      <div class="row between" style={{ marginTop: '6px' }}>
        <div style={{ width: '46%' }}>
          <Bar value={r.hp} max={maxHp} kind="red" label={`${Math.ceil(r.hp)} / ${maxHp}`} style={{ height: '18px' }} />
          <Bar value={r.xp} max={xpNeed(r.size)} kind="xp" label={t('common.level', { n: r.size })} style={{ marginTop: '3px' }} />
        </div>
        <div class="col" style={{ alignItems: 'flex-end', gap: '3px' }}>
          <span class="chip tiny" id="camp-power"><Spr id="icon/power" size={16} />{t('camp.power')} {num(power)}</span>
          <span class="chip tiny" title={t('camp.loot')}><Spr id="icon/coral" size={15} />{num(r.loot.coral)} <Spr id="icon/shine" size={15} />{num(r.loot.shine)}</span>
        </div>
      </div>
      <div class="camp-stage">
        {camp && !waitingBattle ? <Rival r={r} power={power} open={bubble.value === 'rival'} onToggle={() => (bubble.value = bubble.value === 'rival' ? null : 'rival')} onDuel={() => void duel()} /> : <span />}
        <GuardianAhead r={r} after={waitingBattle ? after - 1 : after} open={bubble.value === 'guardian'} onToggle={() => (bubble.value = bubble.value === 'guardian' ? null : 'guardian')} />
      </div>
      {tut.value ? <div class="hint shadow-text" style={{ marginTop: 0, marginBottom: '6px', fontSize: '14px' }} id="camp-tut">{t(tut.value)}</div> : null}
      <div class="panel col" style={{ gap: '8px', padding: '10px' }}>
        <SetChips r={r} />
        <ShellGrid
          r={r} open={selected.value} picking={pending.value !== null} onTap={tapSlot} onMove={moveSlot} merged={merged.value}
          tip={sel && selected.value !== null ? (
            <TenantTip tn={sel} r={r}>
              <div class="row" style={{ gap: '6px', justifyContent: 'flex-end' }}>
                {camp && !waitingBattle && !camp.ordered && sel.star < 3 ? (
                  <Btn class="sm" id="order-btn" disabled={r.pearls < orderPrice(sel)} onClick={() => { const i = selected.value; if (i !== null) order(i); }}>
                    {t('camp.order')} <Spr id="icon/pearl" size={15} />{orderPrice(sel)}
                  </Btn>
                ) : null}
                <Btn class="sm ghost" id="sell-btn" sound="sell" onClick={() => { const i = selected.value; selected.value = null; if (i !== null) void act({ type: 'sell', slot: i }); }}>
                  {t('camp.sell', { n: (BAL.sellPrice[tenantDef(sel.id).rarity - 1] ?? 1) * 3 ** (sel.star - 1) })}
                </Btn>
              </div>
            </TenantTip>
          ) : null}
        />
        {pending.value ? (
          <div class="row between" id="replace-row">
            <span class="small" style={{ color: 'var(--gold)' }}>{t('camp.replace')}</span>
            <button class="icon-btn" id="replace-cancel" aria-label={t('common.cancel')} onClick={() => (pending.value = null)}><Ico id="close" /></button>
          </div>
        ) : null}
        <GeneBars r={r} up={up} />
      </div>
      {camp && !waitingBattle ? (
        <div class="scroll col grow" style={{ marginTop: '6px', paddingTop: '10px', gap: '8px' }}>
          {!camp.offerTaken ? (
            <>
              <div class="cards" id="offers">
                {camp.offers.map((o, i) => <OfferCard offer={o} r={r} foe={foe} key={`${i}-${camp.rerolls}`} id={`offer-${i}`} onPick={() => pick('offer', i, o)} />)}
              </div>
              <div class="row" style={{ justifyContent: 'flex-end' }}>
                <button class="chip tiny" id="skip-offer" onClick={() => void act({ type: 'skip_offer' })}><Ico id="next" size={14} /><Spr id="icon/pearl" size={14} />+2</button>
              </div>
            </>
          ) : null}
          <div class="row" style={{ justifyContent: 'flex-end' }}>
            <div class="row" style={{ gap: '5px' }}>
              {!r.flags.adReroll && (adsAvailable() || p.perks.noAds) ? (
                <button class="chip tiny" id="reroll-ad" aria-label={t('camp.reroll.ad')} onClick={() => void reroll(true)}><Spr id="icon/ad" size={16} />↻</button>
              ) : null}
              <button class="chip tiny" id="reroll" aria-label={t('camp.reroll')} onClick={() => void reroll(false)}>↻ <Spr id="icon/pearl" size={14} />{rerollCost(camp)}</button>
            </div>
          </div>
          <div class="cards" id="shop" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {camp.shop.map((it, i) => <OfferCard offer={it.offer} r={r} foe={foe} price={it.price} sold={it.sold} key={`${i}-${camp.rerolls}`} id={`shop-${i}`} onPick={() => pick('buy', i, it.offer, it.price)} />)}
          </div>
        </div>
      ) : <div class="grow" />}
      <div class="row" style={{ marginTop: '8px', gap: '8px', alignItems: 'flex-end' }}>
        {!waitingBattle ? <Btn class="ghost sm" id="carry-btn" onClick={() => (confirmCarry.value = true)}>{t('camp.carry')}</Btn> : null}
        {paths ? (
          <div class={`currents grow ${camp?.offerTaken ? '' : 'wait'}`} id="currents">
            {paths.map((pl, i) => <Current pool={pl} index={i} key={i} disabled={!camp?.offerTaken || busy.value} onPick={() => void go(i)} />)}
          </div>
        ) : (
          <Btn class="go grow" id="descend-btn" disabled={(!waitingBattle && (atMax || !camp?.offerTaken)) || busy.value} onClick={() => void go()}>
            <span class="col" style={{ gap: 0, alignItems: 'center' }}>
              <span>{waitingBattle ? t('camp.fight.again') : nextInfo?.kind === 'guardian' ? t('camp.fight') : t('camp.descend')} ▸</span>
              {waitingBattle && r.battle ? <span class="sub">{enemyName(r.battle.enemy)}</span> : atMax ? <span class="sub">{t('camp.next.max')}</span> : null}
            </span>
          </Btn>
        )}
      </div>
      {camp?.shellChoices ? (
        <Sheet mid title={t('camp.shell.title')} id="shell-sheet">
          <div class="muted small">{t('camp.shell.sub')}</div>
          <div class="cards">
            {camp.shellChoices.map((s, i) => (
              <button class="card" key={s.id} id={`shell-${i}`} onClick={() => void act({ type: 'choose_shell', index: i })}>
                <Spr id={`shell/${s.id}`} size={64} />
                <div class="nm">{name('shell', s.id)}</div>
                <div class="ds">{modLines(shellDef(s.id).mods).join(', ')}</div>
                <span class="price">{t('camp.shell.slots', { n: slotCount(r.cfg.heroId, s, r.cfg.extraSlots) })}</span>
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
      {confirmCarry.value ? (
        <Sheet mid title={t('camp.carry')} onClose={() => (confirmCarry.value = false)} id="carry-sheet">
          <div>{t('camp.carry.confirm')}</div>
          <div class="row center" style={{ gap: '10px' }}>
            <Res kind="coral" value={Math.floor(r.loot.coral + r.pearls * BAL.pearlToCoral)} />
            <Res kind="shine" value={Math.floor(r.loot.shine)} />
          </div>
          <div class="muted small">{t('camp.carry.note', { n: Math.round(BAL.defeatKeep * 100) })}</div>
          <Btn class="ok wide" id="carry-confirm" onClick={() => void carry()}>{t('camp.carry')}</Btn>
        </Sheet>
      ) : null}
    </div>
  );
}

// --- Battle ---------------------------------------------------------------------------------------

export function BattleView(): JSX.Element | null {
  const b = battle.value;
  const h = battleHud.value;
  const done = useSignal(false);
  useEffect(() => {
    if (h?.done) done.value = true;
  }, [h?.done]);
  if (!b || !h) return null;
  const leave = (): void => {
    battle.value = null;
    screen.value = b.kraken ? 'home' : ended.value ? 'result' : screenForRun(run.value);
    if (b.kraken) panel.value = 'events';
  };
  const mine = b.result.damage[0];
  const total = Object.values(mine).reduce((x, y) => x + y, 0) || 1;
  const rows = Object.entries(mine).sort((x, y) => y[1] - x[1]).slice(0, 6);
  const label = (k: string): { text: string; diet?: Diet; spr?: string } => {
    if (k.startsWith('a')) {
      const tn = b.me.slots[Number(k.slice(1))];
      if (tn) return { text: name('tenant', tn.id), diet: tenantDef(tn.id).families[0], spr: `tenant/${tn.id}` };
    }
    return { text: t(`battle.${k === 'claw' ? 'claw' : k}`), spr: k === 'claw' ? 'icon/claws' : undefined };
  };
  const boss = !b.kraken && b.enemy.kind === 'guardian' && guardianDef(b.enemy.id).boss;
  return (
    <div class="screen pass" id="battle">
      <div class="vs">
        <div class="side">
          <b class="shadow-text">{player.value?.name}</b>
          <Bar value={h.hp[0]} max={h.max[0]} shield={h.shield[0]} label={`${Math.ceil(h.hp[0])}`} />
          <div class="status">{h.status[0].map((s) => <span key={s}>{DIET_STATUS[s] ?? ''}</span>)}</div>
        </div>
        <div class="chip" style={{ marginTop: '14px' }}>{h.time.toFixed(0)}</div>
        <div class="side r">
          <b class="shadow-text" style={boss ? { color: 'var(--gold)' } : undefined}>{b.kraken ? t('guardian.kraken') : enemyName(b.enemy)}</b>
          <Bar value={h.hp[1]} max={h.max[1]} shield={h.shield[1]} kind="red" label={b.kraken ? '∞' : `${Math.ceil(h.hp[1])}`} />
          <div class="status">{h.status[1].map((s) => <span key={s}>{DIET_STATUS[s] ?? ''}</span>)}{b.enemy.kind === 'ghost' ? <span class="tiny muted">{t('battle.ghost')}</span> : null}</div>
        </div>
      </div>
      {h.frenzy && !done.value ? <div class="hint shadow-text" style={{ marginTop: '10px', fontSize: '14px' }}>{t('battle.frenzy')}</div> : null}
      <div class="grow" />
      {!done.value ? (
        <div class="row center" style={{ gap: '8px' }}>
          {[1, 2, 4].map((s) => (
            <Btn class={`sm ${battleSpeed.value === s ? 'go' : 'ghost'}`} key={s} id={`speed-${s}`} onClick={() => (battleSpeed.value = s)}>{t('battle.speed', { n: s })}</Btn>
          ))}
          <Btn class="sm ghost" id="battle-skip" onClick={() => battleScene()?.skip()}>{t('battle.skip')} ⏭</Btn>
        </div>
      ) : (
        <div class="col" style={{ gap: '10px' }}>
          <div class="banner" id="battle-banner" style={{ color: b.won || b.kraken ? 'var(--gold)' : '#ff9a9a' }}>
            {b.kraken ? t('kraken.hit', { n: num(total) }) : b.won ? t('battle.win') : t('battle.lose')}
          </div>
          <div class="panel col">
            <div class="h2">{t('battle.dmg')}</div>
            <div class="meter">
              {rows.map(([k, v]) => {
                const l = label(k);
                return (
                  <>
                    <span class="row" style={{ gap: '4px' }}>{l.spr ? <Spr id={l.spr} size={20} /> : null}{l.text}</span>
                    <div class={`line ${l.diet ? `diet-${l.diet}` : ''}`}><i style={{ width: `${(v / total) * 100}%` }} /></div>
                    <span>{num(v)}</span>
                  </>
                );
              })}
            </div>
            {b.rewards && b.won ? (
              <div class="row center" style={{ gap: '8px' }}>
                <Res kind="pearl" value={`+${b.rewards.pearls}`} />
                {b.rewards.shine ? <Res kind="shine" value={`+${b.rewards.shine}`} /> : null}
                {b.rewards.trophies ? <Res kind="trophy" value={`+${b.rewards.trophies}`} /> : null}
              </div>
            ) : b.rewards?.trophies ? <div class="row center"><Res kind="trophy" value={b.rewards.trophies} /></div> : null}
          </div>
          <Btn class="go big wide" id="battle-continue" onClick={leave}>{t('battle.continue')} ▸</Btn>
        </div>
      )}
    </div>
  );
}

// --- Out of lives ---------------------------------------------------------------------------------

export function DownView(): JSX.Element | null {
  const r = run.value;
  const p = player.value;
  if (!r || !p) return null;
  const chance = async (ad: boolean): Promise<void> => {
    if (ad) {
      const w = await watchAd('second_chance', p.perks.noAds);
      if (!w.ok) return showToast(t(w.reason === 'limit' ? 'ad.limit' : 'ad.failed'));
      if (await act({ type: 'second_chance', adIntentId: w.intentId })) screen.value = screenForRun(run.value);
    } else if (await act({ type: 'second_chance' })) screen.value = screenForRun(run.value);
  };
  const adsLeft = (p.adsToday.second_chance ?? 0) < 1 && (adsAvailable() || p.perks.noAds);
  return (
    <div class="screen" id="down">
      <div class="grow" />
      <div class="panel col center">
        <div class="title">{t('down.title')}</div>
        <div class="muted">{t('down.text', { n: Math.round(BAL.defeatKeep * 100) })}</div>
        <div class="row center" style={{ gap: '10px' }}>
          <Res kind="coral" value={Math.floor(r.loot.coral)} />
          <Res kind="shine" value={Math.floor(r.loot.shine)} />
        </div>
        {p.perks.secondChanceTokens > 0 ? <Btn class="ok wide" id="chance-token" onClick={() => void chance(false)}>{t('down.chance.token')} ({p.perks.secondChanceTokens})</Btn> : null}
        {adsLeft ? <Btn class="gold wide" id="chance-ad" onClick={() => void chance(true)}><Spr id="icon/ad" size={22} />{t('down.chance.ad')}</Btn> : null}
        <Btn class="ghost wide" id="give-up" onClick={() => void act({ type: 'give_up' }).then((e) => e && (screen.value = 'result'))}>{t('down.giveup')}</Btn>
      </div>
    </div>
  );
}

// --- Result ---------------------------------------------------------------------------------------

export function ResultView(): JSX.Element | null {
  const e = ended.value;
  const p = player.value;
  const doubled = useSignal(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!e) return;
    sfx(e.result === 'defeat' ? 'defeat' : 'reward');
    setTimeout(() => {
      showcase()?.celebrate(null, e.result === 'defeat' ? 0x9fc4ff : 0xffe066);
      flyIcons('icon/coral', ref.current, 'res-coral', 7);
    }, 350);
    track('tutorial_step', { step: 'result' });
  }, [e?.runId]);
  if (!e || !p) return null;
  const s = e.summary;
  const fresh = s.newCreatures.length + s.newTenants.length + s.newShells.length + s.newGuardians.length;
  const double = async (): Promise<void> => {
    const w = await watchAd('double_loot', p.perks.noAds);
    if (!w.ok) return showToast(t(w.reason === 'limit' ? 'ad.limit' : 'ad.failed'));
    const res = await meta(() => api.runDouble(e.runId, w.intentId));
    if (res) {
      doubled.value = true;
      sfx('reward');
      flyIcons('icon/coral', ref.current, 'res-coral', 9);
    }
  };
  const share = (): void => {
    track('share', { stage: e.last.stats.maxStage });
    const text = t('share.text', { n: e.last.stats.maxStage });
    const url = `${location.origin}/?startapp=ref_${p.id}`;
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    void import('../platform/share').then((m) => m.shareShell(text, url, tgUrl));
  };
  const canDouble = e.result !== 'defeat' && !doubled.value && (p.adsToday.double_loot ?? 0) < 5 && (adsAvailable() || p.perks.noAds) && s.coral + s.shine > 0;
  return (
    <div class="screen pass" id="result">
      <div class="row between">
        <Res kind="coral" value={p.profile.coral} id="res-coral" />
        <Res kind="shine" value={p.profile.shine} id="res-shine" />
      </div>
      <div class="banner" style={{ marginTop: '10px', fontSize: '30px', color: e.result === 'defeat' ? '#cfe2ff' : 'var(--gold)' }} id="result-title">{t(`result.${e.result}`)}</div>
      <div class="grow" />
      <div class="panel col center" ref={ref}>
        <div class="row center" style={{ gap: '10px' }}>
          <Res kind="coral" value={`+${num(s.coral * (doubled.value ? 2 : 1))}`} />
          <Res kind="shine" value={`+${num(s.shine * (doubled.value ? 2 : 1))}`} />
          {s.trophies ? <Res kind="trophy" value={(s.trophies > 0 ? '+' : '') + s.trophies} /> : null}
        </div>
        {e.result === 'defeat' ? <div class="muted small">{t('result.kept', { n: Math.round(BAL.defeatKeep * 100) })}</div> : null}
        {doubled.value ? <div class="small" style={{ color: 'var(--gold)' }}>{t('result.doubled')}</div> : null}
        <div class="muted small">
          {t('result.stage', { n: e.last.stats.maxStage })} · {t('result.eaten', { n: e.last.stats.eatenTotal })} · {t('result.merges', { n: e.last.stats.merges[0] + e.last.stats.merges[1] })}
        </div>
        {fresh > 0 ? <div class="small">{t('result.new', { n: fresh })}</div> : null}
        {e.questsCompleted.length > 0 ? <div class="small" style={{ color: 'var(--green)' }}>✓ {t('result.quests', { n: e.questsCompleted.length })}</div> : null}
        {s.chapterCleared ? <div class="small" style={{ color: 'var(--gold)' }}>{t('result.chapter')}</div> : null}
        {e.last.stats.maxStage >= CHAPTER_STAGES && s.chapterCleared ? null : null}
      </div>
      <div class="col" style={{ marginTop: '10px' }}>
        {canDouble ? <Btn class="gold wide" id="double-btn" onClick={() => void double()}><Spr id="icon/ad" size={22} />{t('result.double')}</Btn> : null}
        <div class="row">
          <Btn class="ghost" id="share-btn" onClick={share}>{t('result.share')}</Btn>
          <Btn class="go grow" id="home-btn" onClick={() => { ended.value = null; lastEvents.value = []; screen.value = 'home'; }}>{t('result.home')} ▸</Btn>
        </div>
      </div>
    </div>
  );
}
