import { effect } from '@preact/signals';
import { stageInfo, type HuntReport, type PublicRun } from '@shellter/shared';
import { loadAtlas } from './gfx/assets';
import type { CrabLook } from './gfx/crabView';
import { currentScene, setScene } from './gfx/stage';
import { setGameplaySwipes } from './platform/telegram';
import { BattleScene, ShowcaseScene } from './scenes/battle';
import { HuntScene } from './scenes/hunt';
import { music, sfx } from './sound';
import { act, battle, ended, player, run, screen, screenForRun, track } from './state';

/** Decides which Pixi scene is on stage for the current screen and wires scene results to actions. */
let key = '';

export function lookOfRun(r: PublicRun): CrabLook {
  const eq = player.value?.cosmetics.equipped;
  return { heroId: r.cfg.heroId, shell: r.shell, slots: r.slots, mutations: r.mutations, crabSkin: eq?.crab, shellPaint: eq?.shell };
}

export function homeLook(): CrabLook {
  const p = player.value;
  return { heroId: p?.profile.heroId ?? 'hermit', shell: { id: 'periwinkle', tier: 1 }, slots: [], mutations: {}, crabSkin: p?.cosmetics.equipped.crab, shellPaint: p?.cosmetics.equipped.shell };
}

export function showcase(): ShowcaseScene | null {
  const s = currentScene();
  return s instanceof ShowcaseScene ? s : null;
}

export function hunt(): HuntScene | null {
  const s = currentScene();
  return s instanceof HuntScene ? s : null;
}

export function battleScene(): BattleScene | null {
  const s = currentScene();
  return s instanceof BattleScene ? s : null;
}

async function onHuntDone(report: HuntReport): Promise<void> {
  const events = await act({ type: 'hunt_done', report });
  if (!events) {
    // The request failed; the pool is over anyway, so resync with the server.
    screen.value = screenForRun(run.value);
    return;
  }
  if (events.some((e) => e.type === 'ko')) sfx('defeat');
  screen.value = ended.value ? 'result' : screenForRun(run.value);
}

async function biomeAtlas(stage: number): Promise<void> {
  const b = stageInfo(stage).biome;
  await loadAtlas(b === 'trench' ? 'abyss' : b);
}

export function startDirector(): void {
  // Automated tests steer the crab through this hook.
  (window as unknown as { __hunt?: () => HuntScene | null }).__hunt = hunt;
  effect(() => {
    const s = screen.value;
    const r = run.value;
    const b = battle.value;
    const e = ended.value;
    let next = '';
    if (s === 'hunt' && r) next = `hunt:${r.id}:${r.huntNonce}`;
    else if (s === 'battle' && b) next = `battle:${b.stage}:${b.result.duration}:${b.result.events.length}`;
    else if (s === 'camp' || s === 'down') next = 'show:run';
    else if (s === 'result') next = 'show:result';
    else if (s === 'home') next = 'show:home';
    if (next === key) {
      // Same scene: keep the crab on the showcase in sync with the run.
      if (next === 'show:run' && r) showcase()?.setLook(lookOfRun(r));
      if (next === 'show:home') showcase()?.setLook(homeLook());
      return;
    }
    key = next;
    setGameplaySwipes(s === 'hunt' || s === 'battle');
    if (s === 'hunt' && r) {
      const info = stageInfo(r.stage);
      music(info.biome === 'trench' ? 'abyss' : info.biome);
      void biomeAtlas(r.stage).then(() => {
        if (key !== next) return;
        setScene(new HuntScene(r, (report) => void onHuntDone(report)));
        track('screen', { name: 'hunt', stage: r.stage });
      });
    } else if (s === 'battle' && b) {
      music(b.enemy.kind === 'guardian' && (b.enemy.id === 'angler' || b.enemy.id === 'kraken') ? 'boss' : 'battle');
      void loadAtlas('big').then(() => {
        if (key !== next) return;
        try {
          setScene(new BattleScene(b, () => undefined));
        } catch (err) {
          // A broken replay must not strand the player on an empty screen.
          console.error(err);
          battle.value = null;
          screen.value = b.kraken ? 'home' : ended.value ? 'result' : screenForRun(run.value);
        }
      });
    } else if (next === 'show:run' && r) {
      const info = stageInfo(Math.max(1, r.camp?.after ?? r.stage));
      music(info.biome === 'trench' ? 'abyss' : info.biome);
      setScene(new ShowcaseScene(info.biome, lookOfRun(r), { y: 0.2, scale: 1.55 }));
    } else if (next === 'show:result' && e) {
      music('town');
      setScene(new ShowcaseScene(stageInfo(Math.max(1, e.last.stage)).biome, lookOfRun(e.last), { y: 0.3, scale: 1.9 }));
    } else if (next === 'show:home') {
      music('town');
      setScene(new ShowcaseScene('lagoon', null));
    } else {
      setScene(null);
    }
  });
}
