import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function checkAge(authDate: number, nowMs: number, maxAgeS: number): void {
  const now = Math.floor(nowMs / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0) throw new AuthError('bad_init_data');
  if (now - authDate > maxAgeS) throw new AuthError('init_data_expired');
  if (authDate - now > 300) throw new AuthError('bad_init_data');
}

/** Verifies Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data). */
export function verifyInitData(initData: string, botToken: string, nowMs: number, maxAgeS: number): { user: TgUser; startParam?: string } {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AuthError('bad_init_data');
  const pairs: string[] = [];
  for (const [k, v] of params) if (k !== 'hash') pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  if (!safeEqual(expected, hash)) throw new AuthError('bad_init_data');
  checkAge(Number(params.get('auth_date')), nowMs, maxAgeS);
  let user: TgUser;
  try {
    user = JSON.parse(params.get('user') ?? '') as TgUser;
  } catch {
    throw new AuthError('bad_init_data');
  }
  if (!user || !Number.isSafeInteger(user.id)) throw new AuthError('bad_init_data');
  const startParam = params.get('start_param') ?? undefined;
  return startParam ? { user, startParam } : { user };
}

/** Builds signed initData; used by the dev mock and tests. */
export function signInitData(user: TgUser, botToken: string, nowMs: number, startParam?: string): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(nowMs / 1000)));
  params.set('query_id', randomBytes(8).toString('hex'));
  params.set('user', JSON.stringify(user));
  if (startParam) params.set('start_param', startParam);
  const pairs = [...params].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(pairs.join('\n')).digest('hex'));
  return params.toString();
}

/** Verifies Telegram Login Widget data (https://core.telegram.org/widgets/login#checking-authorization). */
export function verifyWidget(data: Record<string, string | number>, botToken: string, nowMs: number, maxAgeS: number): TgUser {
  const hash = String(data.hash ?? '');
  const pairs = Object.keys(data).filter((k) => k !== 'hash').sort().map((k) => `${k}=${data[k]}`);
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  if (!hash || !safeEqual(expected, hash)) throw new AuthError('bad_init_data');
  checkAge(Number(data.auth_date), nowMs, maxAgeS);
  const id = Number(data.id);
  if (!Number.isSafeInteger(id)) throw new AuthError('bad_init_data');
  const user: TgUser = { id };
  if (data.first_name !== undefined) user.first_name = String(data.first_name);
  if (data.username !== undefined) user.username = String(data.username);
  return user;
}

export function signWidget(data: Record<string, string | number>, botToken: string): string {
  const pairs = Object.keys(data).sort().map((k) => `${k}=${data[k]}`);
  return createHmac('sha256', createHash('sha256').update(botToken).digest()).update(pairs.join('\n')).digest('hex');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

const enc = new TextEncoder();

export async function signSession(playerId: string, secret: string, role: 'player' | 'admin' = 'player'): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(playerId)
    .setIssuedAt()
    .setExpirationTime(role === 'admin' ? '12h' : '30d')
    .sign(enc.encode(secret));
}

export async function verifySession(token: string, secret: string): Promise<{ sub: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, enc.encode(secret), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, role: typeof payload.role === 'string' ? payload.role : 'player' };
  } catch {
    return null;
  }
}

export function langOf(code: string | undefined): 'ru' | 'en' {
  return /^(ru|uk|be|kk)/i.test(code ?? '') ? 'ru' : 'en';
}
