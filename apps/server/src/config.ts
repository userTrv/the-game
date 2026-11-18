import { z } from 'zod';

/**
 * Environment:
 *  DATABASE_URL        postgres://user:pass@host:5432/db, or pglite://memory, or pglite://<dir> (zero-setup dev)
 *  PORT, HOST          listen address (default 0.0.0.0:3000); expose only through the reverse proxy
 *  JWT_SECRET          HS256 key for session tokens
 *  BOT_TOKEN           Telegram bot token: verifies Mini App initData and Login Widget data
 *  INTERNAL_SECRET     shared secret of the server <-> bot internal HTTP API
 *  PUBLIC_URL          public https URL of the game (links in notifications)
 *  DEV_AUTH            "true" enables /api/dev/* helpers and the mock ad network; never in production
 *  INIT_DATA_MAX_AGE_S max age of Telegram initData (default 86400)
 *  CORS_ORIGINS        comma separated origins; empty = same origin only ("*" in DEV_AUTH mode)
 *  ADMIN_PASSWORD      password of the admin panel; empty = admin disabled
 *  ADS_REWARD_SECRET   secret that the ad network sends in the Reward URL
 *  CLIENT_DIST         path to the built client; when set the server serves it
 *  ADMIN_DIST          path to the built admin panel, served under /admin
 *  RATE_LIMIT          requests per minute per player or IP (default 240; 0 disables)
 *  LOG_LEVEL           pino level (default info)
 */
const Env = z.object({
  DATABASE_URL: z.string().default('pglite://memory'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  JWT_SECRET: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  INTERNAL_SECRET: z.string().min(1),
  PUBLIC_URL: z.string().default('http://localhost:5173'),
  DEV_AUTH: z.string().default('false'),
  INIT_DATA_MAX_AGE_S: z.coerce.number().int().default(86400),
  CORS_ORIGINS: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  ADS_REWARD_SECRET: z.string().default(''),
  CLIENT_DIST: z.string().default(''),
  ADMIN_DIST: z.string().default(''),
  RATE_LIMIT: z.coerce.number().int().default(240),
  LOG_LEVEL: z.string().default('info'),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  jwtSecret: string;
  botToken: string;
  internalSecret: string;
  publicUrl: string;
  devAuth: boolean;
  initDataMaxAgeS: number;
  corsOrigins: string[];
  adminPassword: string;
  adsRewardSecret: string;
  clientDist: string;
  adminDist: string;
  rateLimit: number;
  logLevel: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${names}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    jwtSecret: e.JWT_SECRET,
    botToken: e.BOT_TOKEN,
    internalSecret: e.INTERNAL_SECRET,
    publicUrl: e.PUBLIC_URL.replace(/\/$/, ''),
    devAuth: e.DEV_AUTH === 'true',
    initDataMaxAgeS: e.INIT_DATA_MAX_AGE_S,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    adminPassword: e.ADMIN_PASSWORD,
    adsRewardSecret: e.ADS_REWARD_SECRET,
    clientDist: e.CLIENT_DIST,
    adminDist: e.ADMIN_DIST,
    rateLimit: e.RATE_LIMIT,
    logLevel: e.LOG_LEVEL,
  };
}

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    databaseUrl: 'pglite://memory',
    port: 0,
    host: '127.0.0.1',
    jwtSecret: 'test-jwt',
    botToken: '123456:TEST',
    internalSecret: 'test-internal',
    publicUrl: 'https://game.test',
    devAuth: false,
    initDataMaxAgeS: 86400,
    corsOrigins: [],
    adminPassword: 'admin-pass',
    adsRewardSecret: 'ads-secret',
    clientDist: '',
    adminDist: '',
    rateLimit: 0,
    logLevel: 'silent',
    ...over,
  };
}
