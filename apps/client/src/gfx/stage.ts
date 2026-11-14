import { Application, Container } from 'pixi.js';

/**
 * One Pixi application for the whole game. Scenes are containers scaled so that the screen is
 * always VIEW_W world units wide; height varies with the device aspect ratio.
 */
export const VIEW_W = 390;

export interface Scene {
  root: Container;
  /** dt in seconds. */
  update(dt: number): void;
  resize?(w: number, h: number): void;
  destroy(): void;
}

let app: Application | null = null;
let current: Scene | null = null;
let viewH = 844;
let frames = 0;
let frameTime = 0;
let worst = 0;

export function viewHeight(): number {
  return viewH;
}

export function pixi(): Application {
  if (!app) throw new Error('pixi not initialised');
  return app;
}

function layout(): void {
  if (!app) return;
  const w = app.renderer.width / app.renderer.resolution;
  const h = app.renderer.height / app.renderer.resolution;
  const k = w / VIEW_W;
  viewH = h / k;
  app.stage.scale.set(k);
  current?.resize?.(VIEW_W, viewH);
}

export async function initStage(host: HTMLElement): Promise<void> {
  app = new Application();
  await app.init({
    resizeTo: host,
    backgroundColor: 0x0e3a66,
    antialias: false,
    // Capped at 2: beyond that phones only burn battery.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    powerPreference: 'high-performance',
  });
  host.appendChild(app.canvas);
  app.renderer.on('resize', layout);
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
    scene.resize?.(VIEW_W, viewH);
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
  if (!app) return;
  if (paused) app.ticker.stop();
  else app.ticker.start();
}
