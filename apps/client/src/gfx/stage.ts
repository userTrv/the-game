import type { Container } from 'pixi.js';
import { Application } from 'pixi.js';

/**
 * One Pixi application for the whole game. Scenes are containers scaled so that the screen is at
 * least MIN_W world units wide and MIN_H tall: a phone in portrait gets exactly MIN_W across,
 * a desktop window gets MIN_H down and as much width as it has.
 */
const MIN_W = 390;
const MIN_H = 700;

export interface Scene {
  root: Container;
  /** dt in seconds. */
  update(dt: number): void;
  resize?(w: number, h: number): void;
  destroy(): void;
}

let app: Application | null = null;
let hostEl: HTMLElement | null = null;
let current: Scene | null = null;
let viewW = MIN_W;
let viewH = 844;
let frames = 0;
let frameTime = 0;
let worst = 0;

export function viewWidth(): number {
  return viewW;
}

export function viewHeight(): number {
  return viewH;
}

export function pixi(): Application {
  if (!app) throw new Error('pixi not initialised');
  return app;
}

function layout(): void {
  if (!app) return;
  // CSS size of the host, not the renderer's: the renderer may still hold its pre-resize size.
  const w = hostEl?.clientWidth || app.renderer.width / app.renderer.resolution;
  const h = hostEl?.clientHeight || app.renderer.height / app.renderer.resolution;
  const k = Math.min(w / MIN_W, h / MIN_H);
  viewW = w / k;
  viewH = h / k;
  app.stage.scale.set(k);
  current?.resize?.(viewW, viewH);
}

export async function initStage(host: HTMLElement): Promise<void> {
  hostEl = host;
  app = new Application();
  await app.init({
    resizeTo: host,
    backgroundColor: 0x02141a,
    antialias: false,
    // Capped at 2: beyond that phones only burn battery.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
  });
  host.appendChild(app.canvas);
  app.renderer.on('resize', layout);
  new ResizeObserver(() => {
    app?.resize();
    layout();
  }).observe(host);
  layout();
  app.ticker.add((ticker) => {
    // Clamp long frames (tab switch, GC) so simulations never jump.
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    frames += 1;
    frameTime += ticker.deltaMS;
    worst = Math.max(worst, ticker.deltaMS);
    current?.update(dt);
  });
}

export function setScene(scene: Scene | null): void {
  if (!app) return;
  if (current) {
    app.stage.removeChild(current.root);
    current.destroy();
  }
  current = scene;
  if (scene) {
    app.stage.addChild(scene.root);
    scene.resize?.(viewW, viewH);
  }
}

export function currentScene(): Scene | null {
  return current;
}

/** Average FPS and worst frame since the last call; reported to analytics. */
export function takeFps(): { fps: number; worstMs: number } {
  const out = { fps: frameTime > 0 ? Math.round((frames * 1000) / frameTime) : 0, worstMs: Math.round(worst) };
  frames = 0;
  frameTime = 0;
  worst = 0;
  return out;
}

export function setPaused(paused: boolean): void {
  // The ticker does not exist until the renderer has finished starting.
  if (!app?.ticker) return;
  if (paused) app.ticker.stop();
  else app.ticker.start();
}
