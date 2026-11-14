import { afterAll, describe, expect, it } from 'vitest';
import { harness, type Harness } from './helpers';

const open: Harness[] = [];
afterAll(async () => {
  for (const h of open) await h.close();
});

describe('guards', () => {
  it('dev endpoints do not exist without DEV_AUTH', async () => {
    const h = await harness({ devAuth: false });
    open.push(h);
    const a = await h.guest();
    expect((await h.call('POST', '/api/dev/grant', { coral: 1 }, a.token)).status).toBe(404);
    expect((await h.call('POST', '/api/dev/init-data', { user: { id: 1 } })).status).toBe(404);
    expect((await h.call('POST', '/api/dev/ad-watch', {}, a.token)).status).toBe(404);
    expect((await h.call('GET', '/health')).status).toBe(200);
    expect((await h.call('GET', '/ready')).status).toBe(200);
  });

  it('rate limiting answers 429 with the uniform error body', async () => {
    const h = await harness({ rateLimit: 5 });
    open.push(h);
    let limited: { status: number; body: unknown } | null = null;
    for (let i = 0; i < 8; i++) {
      const r = await h.call('GET', '/health');
      if (r.status === 429) limited = r;
    }
    expect(limited).not.toBeNull();
    expect((limited!.body as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('admin is closed when no password is configured', async () => {
    const h = await harness({ adminPassword: '' });
    open.push(h);
    expect((await h.call('POST', '/admin/api/login', { password: '' })).status).toBe(403);
  });
});
