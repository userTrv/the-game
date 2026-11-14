import { heroDef, mutationDef, type BuildSnapshot, type MutSlot, type TenantInst } from '@shellter/shared';
import { Container, Sprite } from 'pixi.js';
import { hasSprite, setSprite, shellSlots, sprite, tex, type ShellSlot } from './assets';

export interface CrabLook {
  heroId: string;
  shell: { id: string; tier: number };
  slots: (TenantInst | null)[];
  mutations: BuildSnapshot['mutations'];
  /** Cosmetics. */
  crabSkin?: string;
  shellPaint?: string;
}

const STAR_TINT = [0xffffff, 0xcfe8ff, 0xffe066];

/**
 * The hero: a crab assembled from parts with a shell whose slots carry the tenants. The same view
 * is used in the pool, in battles (for both sides), at the camp and on the result screen.
 */
export class CrabView extends Container {
  private shadow: Sprite;
  private shellBox = new Container();
  private shell: Sprite;
  private tenantLayer = new Container();
  private tenants: { root: Container; s: Sprite; aura: Sprite | null; pulse: number; slot: ShellSlot; base: number }[] = [];
  private bodyBox = new Container();
  private legs: Sprite[] = [];
  private body: Sprite;
  private carapace: Sprite;
  private claw: Sprite;
  private antenna: Sprite;
  private t = Math.random() * 10;
  private hide = 0;
  private snapT = 0;
  private squash = 0;
  private look: CrabLook | null = null;
  hidden = false;
  moving = false;
  shellScale = 0.62;

  constructor() {
    super();
    this.shadow = sprite('fx/shadow');
    this.shadow.alpha = 0.7;
    this.shell = sprite('shell/periwinkle');
    this.shellBox.addChild(this.shell, this.tenantLayer);
    this.body = sprite('crab/hermit/body');
    this.carapace = sprite('crab/carapace_soft');
    this.claw = sprite('crab/hermit/claw');
    this.antenna = sprite('crab/hermit/antenna');
    for (let i = 0; i < 3; i++) {
      const leg = sprite('crab/hermit/leg');
      this.legs.push(leg);
      this.bodyBox.addChild(leg);
    }
    this.bodyBox.addChild(this.antenna, this.body, this.carapace, this.claw);
    this.addChild(this.shadow, this.shellBox, this.bodyBox);
  }

  setLook(look: CrabLook): void {
    this.look = look;
    const hero = heroDef(look.heroId);
    const skin = look.crabSkin && look.crabSkin !== 'crab_default' && hero.id === 'hermit' && hasSprite(`crab/${look.crabSkin}/body`) ? look.crabSkin : hero.id;
    const part = (slot: MutSlot, name: string): string => {
      const m = look.mutations[slot];
      return m ? `crab/${name}_${mutationDef(m.id).diet}` : `crab/${skin}/${name}`;
    };
    const k = 0.82;
    setSprite(this.body, `crab/${skin}/body`, k);
    setSprite(this.claw, part('claws', 'claw'), k);
    setSprite(this.antenna, part('antennae', 'antenna'), k);
    for (const leg of this.legs) setSprite(leg, part('legs', 'leg'), k);
    const car = look.mutations.carapace;
    this.carapace.visible = car !== undefined;
    if (car) setSprite(this.carapace, `crab/carapace_${mutationDef(car.id).diet}`, k);
    this.body.position.set(8, 0);
    this.carapace.position.set(8, 0);
    this.claw.position.set(20, -7);
    this.antenna.position.set(18, -22);
    this.legs.forEach((leg, i) => leg.position.set(-2 + i * 8, -9));

    // Shell and tenants.
    const paint = look.shellPaint && look.shellPaint !== 'shell_default' && hasSprite(`shell/paint_${look.shellPaint}`) ? `paint_${look.shellPaint}` : look.shell.id;
    this.shellScale = 0.6 + 0.085 * look.shell.tier;
    setSprite(this.shell, `shell/${paint}`, this.shellScale);
    this.shellBox.position.set(2, -10);
    const anchors = shellSlots(paint);
    this.tenantLayer.removeChildren();
    this.tenants = [];
    look.slots.forEach((t, i) => {
      if (!t) return;
      const slot = anchors[i % Math.max(1, anchors.length)] ?? { x: -20, y: -30, rot: 0 };
      const root = new Container();
      const base = this.shellScale * (0.62 + 0.17 * (t.star - 1));
      let aura: Sprite | null = null;
      if (t.star > 1) {
        aura = new Sprite(tex('fx/dot'));
        aura.anchor.set(0.5);
        aura.tint = STAR_TINT[t.star - 1] ?? 0xffffff;
        aura.blendMode = 'add';
        aura.alpha = 0.55;
        aura.scale.set((t.star === 3 ? 1.5 : 1.15) * base);
        aura.y = -14 * base;
        root.addChild(aura);
      }
      const s = sprite(`tenant/${t.id}`, base);
      root.addChild(s);
      root.position.set(slot.x * this.shellScale, slot.y * this.shellScale);
      root.rotation = (slot.rot * Math.PI) / 180;
      this.tenantLayer.addChild(root);
      this.tenants.push({ root, s, aura, pulse: 0, slot, base });
    });
    // Tenants further back are drawn first so the front row overlaps them.
    this.tenantLayer.children.sort((a, b) => a.y - b.y);
    this.shadow.scale.set(0.5 + 0.06 * look.shell.tier, 0.5);
    this.shadow.position.set(-6, 2);
  }

  getLook(): CrabLook | null {
    return this.look;
  }

  /** World-space position (relative to this view) of a tenant slot, for projectiles. */
  slotPoint(index: number): { x: number; y: number } {
    const present = this.look ? this.look.slots.slice(0, index + 1).filter(Boolean).length - 1 : -1;
    const t = this.tenants[present];
    if (!t || !this.look?.slots[index]) return { x: 0, y: -24 * this.scale.y };
    return { x: (this.shellBox.x + t.root.x) * this.scale.x, y: (this.shellBox.y + t.root.y - 10) * this.scale.y };
  }

  /** Makes a tenant bounce when its ability fires. */
  pulseSlot(index: number): void {
    if (!this.look?.slots[index]) return;
    const present = this.look.slots.slice(0, index + 1).filter(Boolean).length - 1;
    const t = this.tenants[present];
    if (t) t.pulse = 1;
  }

  snap(): void {
    this.snapT = 1;
  }

  /** Squash & stretch impulse: eating, getting hit, growing. */
  bump(amount = 1): void {
    this.squash = Math.min(1.4, this.squash + amount);
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    this.hide += ((this.hidden ? 1 : 0) - this.hide) * Math.min(1, dt * 14);
    this.squash = Math.max(0, this.squash - dt * 5);
    this.snapT = Math.max(0, this.snapT - dt * 6);
    const h = this.hide;

    // Body tucks into the shell mouth.
    const out = 1 - h;
    this.bodyBox.scale.set(0.25 + 0.75 * out);
    this.bodyBox.position.set(-10 * h, -8 * h);
    this.bodyBox.alpha = Math.min(1, out * 3);
    const walk = this.moving && !this.hidden ? 1 : 0.15;
    this.legs.forEach((leg, i) => {
      leg.rotation = Math.sin(t * 16 * walk + i * 2.1) * 0.5 * walk;
    });
    this.body.y = Math.sin(t * (this.moving ? 14 : 3)) * (this.moving ? 1 : 0.6);
    this.carapace.y = this.body.y;
    this.claw.rotation = Math.sin(t * 2.4) * 0.12 - this.snapT * 0.9;
    this.antenna.rotation = Math.sin(t * 3.1) * 0.18;

    // Shell: breathes, squashes on impulses, sits down when hiding.
    const sq = Math.sin(this.squash * Math.PI) * 0.16;
    this.shellBox.scale.set(1 + sq + h * 0.05, 1 - sq - h * 0.05 + Math.sin(t * 2) * 0.012);
    this.shellBox.rotation = Math.sin(t * (this.moving ? 12 : 1.6)) * (this.moving ? 0.035 : 0.015) + h * 0.12;
    this.shellBox.y = -10 + h * 8;

    for (let i = 0; i < this.tenants.length; i++) {
      const tn = this.tenants[i]!;
      tn.pulse = Math.max(0, tn.pulse - dt * 4);
      const p = Math.sin(tn.pulse * Math.PI) * 0.45;
      tn.s.scale.set((tn.base * (1 + p * 0.6)) / 2, (tn.base * (1 + p)) / 2);
      tn.root.rotation = (tn.slot.rot * Math.PI) / 180 + Math.sin(t * 2.2 + i * 1.3) * 0.08;
      if (tn.aura) tn.aura.alpha = 0.4 + 0.2 * Math.sin(t * 3 + i);
    }
  }
}
