import type { AuthResponse, ClientRunAction, HuntReportSchema, RunActionResponse } from '@shellter/shared';
import type { z } from 'zod';
import { buildApp } from '../src/app';
import { signInitData } from '../src/auth';
import { testConfig, type Config } from '../src/config';
import { connect, type DbHandle } from '../src/db';

export interface Harness {
  app: ReturnType<typeof buildApp>;
  handle: DbHandle;
  config: Config;
  time: { now: number };
  close(): Promise<void>;
  call<T = unknown>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, token?: string, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  guest(): Promise<AuthResponse>;
  telegram(id: number, startParam?: string, name?: string): Promise<AuthResponse>;
}

export async function harness(over: Partial<Config> = {}): Promise<Harness> {
  const config = testConfig(over);
  const handle = await connect(process.env.TEST_DATABASE_URL ?? 'pglite://memory');
  const time = { now: Date.UTC(2026, 10, 11, 12) };
  const app = buildApp({ db: handle.db, config, now: () => time.now });
  await app.ready();
  const call: Harness['call'] = async (method, url, body, token, headers = {}) => {
    const h: Record<string, string> = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    const res = await app.inject({ method, url, headers: h, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: res.statusCode, body: res.json() };
  };
  return {
    app, handle, config, time, call,
    async close() {
      await app.close();
      await handle.close();
    },
    async guest() {
      return (await call<AuthResponse>('POST', '/api/auth/guest', {})).body;
    },
    async telegram(id, startParam, name = `User${id}`) {
      const initData = signInitData({ id, first_name: name, language_code: 'ru' }, config.botToken, time.now, startParam);
      return (await call<AuthResponse>('POST', '/api/auth/telegram', { initData })).body;
    },
  };
}

export const REPORT: z.infer<typeof HuntReportSchema> = {
  eaten: { moon_jelly: 12, plankton_spark: 6, sand_worm: 6 },
  nodes: { oyster: 3, coral: 4, glitter: 0 },
  durationS: 60,
  hpLost: 5,
  ko: false,
};

/** Drives one run through the API. */
export class RunDriver {
  seq = 0;
  constructor(private h: Harness, private token: string, public runId: string) {}
  async act(action: ClientRunAction) {
    this.seq += 1;
    return this.h.call<RunActionResponse & { error?: { code: string } }>('POST', '/api/run/action', { runId: this.runId, seq: this.seq, action }, this.token);
  }
  async ok(action: ClientRunAction): Promise<RunActionResponse> {
    const r = await this.act(action);
    if (r.status !== 200) throw new Error(`${action.type}: ${JSON.stringify(r.body)}`);
    return r.body;
  }
  /** Hunt (advancing the clock), then clear the camp so `descend` is legal. */
  async hunt(report = REPORT): Promise<RunActionResponse> {
    this.h.time.now += (report.durationS + 5) * 1000;
    let r = await this.ok({ type: 'hunt_done', report });
    if (r.run?.camp?.shellChoices) r = await this.ok({ type: 'choose_shell', index: 0 });
    return r;
  }
}

export async function startRun(h: Harness, token: string, heroId = 'hermit'): Promise<RunDriver> {
  const r = await h.call<{ run: { id: string } }>('POST', '/api/run/start', { heroId }, token);
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return new RunDriver(h, token, r.body.run.id);
}
