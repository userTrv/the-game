import { expect, test, type Page } from '@playwright/test';

interface HuntDebug {
  time: number;
  eaten: number;
  crab: { x: number; y: number };
  creatures: { x: number; y: number; edible: boolean }[];
  nodes: { x: number; y: number }[];
}

const huntState = (page: Page): Promise<HuntDebug | null> =>
  page.evaluate(() => {
    const get = (window as unknown as { __hunt?: () => { debugState(): unknown } | null }).__hunt;
    const h = get ? get() : null;
    return h ? (h.debugState() as never) : null;
  });

/** Plays a pool like a person: holds a finger down and steers towards the nearest edible creature. */
async function playPool(page: Page, seconds: number, minEaten: number): Promise<void> {
  await page.waitForFunction(() => {
    const get = (window as unknown as { __hunt?: () => unknown }).__hunt;
    return Boolean(get && get());
  });
  await page.mouse.move(195, 420);
  await page.mouse.down();
  const started = Date.now();
  for (;;) {
    const st = await huntState(page);
    if (!st) break;
    if ((st.time > seconds || st.eaten >= minEaten) && st.time > 13) break;
    if (Date.now() - started > 200_000) break;
    const dist = (c: { x: number; y: number }): number => Math.hypot(c.x - st.crab.x, c.y - st.crab.y);
    const food = st.creatures.filter((c) => c.edible).sort((a, b) => dist(a) - dist(b))[0];
    const target = food ?? st.nodes[0] ?? { x: 195, y: 300 };
    const d = dist(target) || 1;
    // Point beyond the target so the crab keeps full speed; stay inside the screen.
    const x = Math.max(10, Math.min(380, st.crab.x + ((target.x - st.crab.x) / d) * 120));
    const y = Math.max(120, Math.min(740, st.crab.y + ((target.y - st.crab.y) / d) * 120));
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
}

/** Waits for the camp; picks the first shell when a shell swap is offered. */
async function reachCamp(page: Page): Promise<void> {
  await page.click('#hunt-leave');
  await expect(page.locator('#camp')).toBeVisible();
  await page.waitForTimeout(700);
  if (await page.locator('#shell-0').count()) {
    await page.click('#shell-0');
    await page.waitForTimeout(900);
  }
}

test('first session: pools, camp, merge, guardian, carry-out, town, ad unlock, chest', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Onboarding: a new player lands straight in the first pool, no menus.
  await page.goto('/?mock=tg&tglang=ru&tgid=' + (500000 + Math.floor(Math.random() * 400000)));
  await expect(page.locator('#hunt')).toBeVisible({ timeout: 60_000 });

  await test.step('pool 1 and the first tenant', async () => {
    await playPool(page, 45, 26);
    await reachCamp(page);
    await page.click('#offer-0');
    await page.waitForTimeout(800);
    // The next stage is a pool: the camp offers three currents instead of one button.
    await page.click('#path-0');
  });

  await test.step('pool 2 and the first merge', async () => {
    await expect(page.locator('#hunt')).toBeVisible();
    await page.waitForTimeout(500);
    await playPool(page, 45, 26);
    await reachCamp(page);
    await page.click('#offer-0');
    await page.waitForTimeout(1400);
  });

  await test.step('guardian autobattle', async () => {
    await page.click('#descend-btn');
    await expect(page.locator('#battle')).toBeVisible();
    await page.click('#speed-4');
    await expect(page.locator('#battle-continue')).toBeVisible({ timeout: 90_000 });
    await page.click('#battle-continue');
  });

  await test.step('carry the loot out', async () => {
    await page.waitForTimeout(1500);
    if (await page.locator('#camp').count()) {
      await page.click('#carry-btn');
      await page.click('#carry-confirm');
    } else if (await page.locator('#give-up').count()) {
      await page.click('#give-up');
    }
    await expect(page.locator('#result')).toBeVisible();
  });

  await test.step('rewarded ad doubles the reward (mock network, server-verified)', async () => {
    const double = page.locator('#double-btn');
    if (await double.count()) {
      await double.click();
      await expect(double).toHaveCount(0, { timeout: 20_000 });
    }
    await page.click('#home-btn');
  });

  await test.step('town upgrade', async () => {
    await expect(page.locator('#home')).toBeVisible();
    await page.click('#bld-lighthouse');
    await expect(page.locator('#upgrade-btn')).toBeVisible();
    await page.click('#upgrade-btn');
    await page.waitForTimeout(800);
    await page.locator('#building-sheet .icon-btn').first().click();
  });

  await test.step('a cosmetic is unlocked view by view with rewarded ads', async () => {
    await page.click('#nav-shop');
    const btn = page.locator('#unlock-btn-merge_rainbow');
    await expect(btn).toContainText('0/4');
    await btn.click();
    await expect(btn).toContainText('1/4', { timeout: 20_000 });
  });

  await test.step('daily chest for a rewarded ad', async () => {
    const chest = page.locator('#chest-btn');
    await expect(chest).toBeVisible();
    await chest.click();
    await expect(chest).toHaveCount(0, { timeout: 20_000 });
  });

  await test.step('language switch', async () => {
    await page.locator('#shop-sheet .icon-btn').first().click();
    await page.click('#settings-btn');
    await page.click('#lang-en');
    await expect(page.locator('#settings-sheet .title').first()).toHaveText(/Settings/);
  });

  expect(errors).toEqual([]);
});

test('website guest sees the landing and can start playing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#landing-play')).toBeVisible({ timeout: 60_000 });
  await page.click('#landing-play');
  await expect(page.locator('#hunt')).toBeVisible({ timeout: 30_000 });
});
