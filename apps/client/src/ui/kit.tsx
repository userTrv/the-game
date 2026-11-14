import { DIETS, tenantDef, type AbilityDef, type Cost, type Diet, type ModPatch, type Star, type TenantDef } from '@shellter/shared';
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
