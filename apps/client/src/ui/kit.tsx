import { DIETS, heroDef, tenantDef, type AbilityDef, type Cost, type Diet, type LinkDef, type ModPatch, type Star, type TenantDef } from '@shellter/shared';
import type { ComponentChildren, JSX } from 'preact';
import { atlasUrl, BAKE, frame, manifest } from '../gfx/assets';
import { num, stat, t } from '../i18n';
import { sfx } from '../sound';
import { haptic } from '../state';

/** A sprite from the baked atlas, drawn with CSS so DOM screens share art with the canvas. */
export function Spr(props: { id: string; size?: number; class?: string; style?: JSX.CSSProperties }): JSX.Element | null {
  const f = frame(props.id);
  if (!f) return null;
  const atlas = manifest.atlases[f.atlas];
  if (!atlas) return null;
  const w = f.w / BAKE;
  const h = f.h / BAKE;
  const k = props.size ? props.size / Math.max(w, h) : 1;
  return (
    <span
      class={`spr ${props.class ?? ''}`}
      style={{
        width: `${w * k}px`,
        height: `${h * k}px`,
        backgroundImage: `url(${atlasUrl(f.atlas)})`,
        backgroundSize: `${(atlas.w / BAKE) * k}px ${(atlas.h / BAKE) * k}px`,
        backgroundPosition: `-${(f.x / BAKE) * k}px -${(f.y / BAKE) * k}px`,
        ...props.style,
      }}
    />
  );
}

const ICONS = {
  quests: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  events: 'M2 9c3-4 6-4 9 0s6 4 11 0M2 16c3-4 6-4 9 0s6 4 11 0',
  almanac: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M9 8h6',
  shop: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  inbox: 'M3 6h18v12H3zM3 7l9 7 9-7',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  medal: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z',
  close: 'M6 6l12 12M18 6L6 18',
  pause: 'M9 5v14M15 5v14',
  next: 'M9 5l7 7-7 7',
  calm: 'M2 9c3-3 6-3 9 0s6 3 11 0M2 15c3-3 6-3 9 0s6 3 11 0',
  dark: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  nest: 'M4 11h16v8H4zM4 11l2-5h12l2 5M10 14h4',
  duel: 'M5 4l11 11M19 4L8 15M5 4v3M5 4h3M19 4v3M19 4h-3M6 14l4 4M18 14l-4 4M5 20l3-3M19 20l-3-3',
  weak: 'M13 2L6 13h5l-1 9 8-12h-5z',
  resist: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  link: 'M9 15l6-6M10 7l1.5-1.5a3.5 3.5 0 0 1 5 5L15 12M14 17l-1.5 1.5a3.5 3.5 0 0 1-5-5L9 12',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  fang: 'M5 5h14l-3 6-2-3-2 11-2-11-2 3z',
  shell: 'M4 18c0-8 5-13 11-13 4 0 6 3 6 6 0 4-3 7-7 7zM4 18h10M9 18c0-5 2-8 6-9',
} as const;

/** Line icon drawn with the text colour. */
export function Ico(props: { id: keyof typeof ICONS; size?: number }): JSX.Element {
  return <svg class="ico" viewBox="0 0 24 24" style={props.size ? { width: `${props.size}px`, height: `${props.size}px` } : undefined} aria-hidden="true"><path d={ICONS[props.id]} /></svg>;
}

export function Btn(props: { class?: string; onClick?: () => void; disabled?: boolean; children: ComponentChildren; id?: string; sound?: Parameters<typeof sfx>[0] }): JSX.Element {
  return (
    <button
      id={props.id}
      class={`btn ${props.class ?? ''}`}
      disabled={props.disabled}
      onClick={() => {
        sfx(props.sound ?? 'ui_tap');
        haptic('light');
        props.onClick?.();
      }}
    >
      {props.children}
    </button>
  );
}

export function Res(props: { kind: 'coral' | 'shine' | 'pearl' | 'trophy' | 'stars' | 'life'; value: number | string; id?: string; class?: string }): JSX.Element {
  return (
    <span class={`chip ${props.class ?? ''}`} id={props.id}>
      <Spr id={`icon/${props.kind}`} size={22} />
      {typeof props.value === 'number' ? num(props.value) : props.value}
    </span>
  );
}

export function CostView(props: { cost: Partial<Cost>; have?: { coral: number; shine: number } }): JSX.Element {
  const { cost, have } = props;
  return (
    <span class="row" style={{ gap: '10px' }}>
      {cost.coral ? (
        <span class="row" style={{ gap: '3px', color: have && have.coral < cost.coral ? 'var(--red)' : undefined }}>
          <Spr id="icon/coral" size={18} />
          {num(cost.coral)}
        </span>
      ) : null}
      {cost.shine ? (
        <span class="row" style={{ gap: '3px', color: have && have.shine < cost.shine ? 'var(--red)' : undefined }}>
          <Spr id="icon/shine" size={18} />
          {num(cost.shine)}
        </span>
      ) : null}
    </span>
  );
}

export function Bar(props: { value: number; max: number; shield?: number; kind?: 'red' | 'xp'; label?: string; style?: JSX.CSSProperties }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (props.value / Math.max(1, props.max)) * 100));
  const sh = Math.max(0, Math.min(100, ((props.shield ?? 0) / Math.max(1, props.max)) * 100));
  return (
    <div class="bar" style={props.style}>
      <i class={props.kind ?? ''} style={{ width: `${pct}%` }} />
      {sh > 0 ? <i class="sh" style={{ width: `${sh}%` }} /> : null}
      {props.label ? <span>{props.label}</span> : null}
    </div>
  );
}

export function Stars(props: { n: number }): JSX.Element {
  return <span class="stars">{'★'.repeat(props.n)}</span>;
}

export function Sheet(props: { title?: string; onClose?: () => void; children: ComponentChildren; mid?: boolean; id?: string }): JSX.Element {
  return (
    <div class={`sheet-back ${props.mid ? 'mid' : ''}`} id={props.id} onClick={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div class="sheet">
        {props.title || props.onClose ? (
          <div class="sheet-head">
            <div class="title">{props.title}</div>
            {props.onClose ? (
              <button class="icon-btn" aria-label={t('common.close')} onClick={props.onClose}>
                ✕
              </button>
            ) : null}
          </div>
        ) : null}
        {props.children}
      </div>
    </div>
  );
}

export function DietIcon(props: { diet: Diet; size?: number }): JSX.Element | null {
  return <Spr id={`icon/diet_${props.diet}`} size={props.size ?? 18} />;
}

const r1 = (v: number): string => String(Math.round(v * 10) / 10);

/** Human-readable lines for a mod patch. */
export function modLines(patch: ModPatch | undefined): string[] {
  if (!patch) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'power') {
      const p = v as Partial<Record<Diet, number>>;
      const diets = DIETS.filter((d) => p[d]);
      if (diets.length === DIETS.length) out.push(stat('power', { v: r1(p.sting ?? 0), diet: '★' }));
      else for (const d of diets) out.push(stat('power', { v: r1(p[d] ?? 0), diet: t(`diet.${d}`).toLowerCase() }));
    } else if (typeof v === 'number' && v !== 0) {
      out.push(stat(k, { v: k === 'speedPct' ? (v > 0 ? `+${r1(v)}` : r1(v)) : r1(v) }));
    }
  }
  return out;
}

export function abilityText(a: AbilityDef, star: Star): string {
  if (a.type === 'passive') return modLines(a.mods[star - 1]).join(', ');
  const v = a.v[star - 1] as number;
  let s = a.kind === 'zap' && a.n ? stat('ab.zap.n', { v: r1(v), n: a.n }) : stat(`ab.${a.kind}`, { v: r1(v) });
  if (a.also) s += ` ${stat('ab.also', {})} ${stat(`ab.${a.also.kind}`, { v: r1(a.also.v[star - 1] as number) }).toLowerCase()}`;
  return a.kind === 'burst' ? s : `${s}, ${stat('ab.cd', { v: r1(a.cd) })}`;
}

export function tenantText(id: string, star: Star): string {
  return abilityText(tenantDef(id).ability, star);
}

/** One line for what a tenant does to (or gets from) its neighbours. */
export function LinkLine(props: { link: LinkDef; star: Star; heroId: string }): JSX.Element {
  const { link } = props;
  const v = r1((link.v[props.star - 1] as number) * (heroDef(props.heroId).linkPower ?? 1));
  const key = link.kind === 'aura' ? `link.aura.${link.stat}` : `link.${link.kind}`;
  return (
    <div class="linkline">
      <Ico id="link" size={15} />
      {link.family ? <DietIcon diet={link.family} size={15} /> : null}
      <span>{t(link.family && link.kind !== 'solo' ? `${key}.family` : key, { v })}</span>
    </div>
  );
}

export function roleKey(def: TenantDef): string {
  return `camp.role.${def.role}`;
}

/** Flies a few icons from one element to another (rewards landing in a counter). */
export function flyIcons(spriteId: string, from: Element | null, toId: string, count = 6): void {
  const to = document.getElementById(toId);
  const host = document.getElementById('ui');
  const f = frame(spriteId);
  const atlas = f ? manifest.atlases[f.atlas] : undefined;
  if (!from || !to || !host || !f || !atlas) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const base = host.getBoundingClientRect();
  const k = 26 / Math.max(f.w / BAKE, f.h / BAKE);
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = 'spr fly';
    el.style.width = `${(f.w / BAKE) * k}px`;
    el.style.height = `${(f.h / BAKE) * k}px`;
    el.style.backgroundImage = `url(${atlasUrl(f.atlas)})`;
    el.style.backgroundSize = `${(atlas.w / BAKE) * k}px ${(atlas.h / BAKE) * k}px`;
    el.style.backgroundPosition = `-${(f.x / BAKE) * k}px -${(f.y / BAKE) * k}px`;
    el.style.left = `${a.left + a.width / 2 - base.left - 13}px`;
    el.style.top = `${a.top + a.height / 2 - base.top - 13}px`;
    el.style.setProperty('--mx', `${(Math.random() - 0.5) * 90}px`);
    el.style.setProperty('--my', `${-30 - Math.random() * 60}px`);
    el.style.setProperty('--tx', `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
    el.style.setProperty('--ty', `${b.top + b.height / 2 - (a.top + a.height / 2)}px`);
    el.style.animationDelay = `${i * 0.06}s`;
    host.appendChild(el);
    setTimeout(() => {
      el.remove();
      if (i === 0) {
        to.classList.remove('pop');
        void (to as HTMLElement).offsetWidth;
        to.classList.add('pop');
        sfx('coin_tick');
      }
    }, 850 + i * 60);
  }
}
