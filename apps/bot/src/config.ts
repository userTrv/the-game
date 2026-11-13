import { z } from 'zod';

const DEFAULT_API_ROOT = 'https://api.telegram.org';

/** Environment variables whose values must never appear in error messages or logs. */
const SECRET_KEYS = new Set(['BOT_TOKEN', 'INTERNAL_SECRET', 'WEBHOOK_SECRET']);

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

function httpUrl(name: string): z.ZodType<string> {
  return z
    .string()
    .trim()
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, `${name} must be an http(s) URL`)
    .transform((value) => value.replace(/\/+$/, ''));
}

const port = z.coerce.number().int().min(0).max(65535);

const envSchema = z
  .object({
    BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/, 'must look like <bot id>:<secret>'),
    TELEGRAM_API_ROOT: z.preprocess(emptyToUndefined, httpUrl('TELEGRAM_API_ROOT').default(DEFAULT_API_ROOT)),
    INTERNAL_SECRET: z.string().min(1),
    SERVER_INTERNAL_URL: httpUrl('SERVER_INTERNAL_URL'),
    BOT_INTERNAL_PORT: z.preprocess(emptyToUndefined, port.default(8082)),
    BOT_INTERNAL_HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
    MINI_APP_URL: z
      .string()
      .trim()
      .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), 'must be an http(s) URL'),
    BOT_MODE: z.preprocess(emptyToUndefined, z.enum(['polling', 'webhook']).default('polling')),
    WEBHOOK_URL: z.preprocess(emptyToUndefined, httpUrl('WEBHOOK_URL').optional()),
    WEBHOOK_SECRET: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,256}$/, 'must be 1-256 characters A-Z, a-z, 0-9, _ and -')
        .optional(),
    ),
    SUPPORT_CONTACT: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(200)),
    BROADCAST_RPS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(30).default(25)),
    LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info')),
  })
  .superRefine((env, ctx) => {
    if (env.BOT_MODE === 'webhook') {
      if (env.WEBHOOK_URL === undefined) {
        ctx.addIssue({ code: 'custom', path: ['WEBHOOK_URL'], message: 'is required when BOT_MODE=webhook' });
      } else if (!env.WEBHOOK_URL.startsWith('https://') && env.TELEGRAM_API_ROOT === DEFAULT_API_ROOT) {
        ctx.addIssue({ code: 'custom', path: ['WEBHOOK_URL'], message: 'must be an https URL' });
      }
      if (env.WEBHOOK_SECRET === undefined) {
        ctx.addIssue({ code: 'custom', path: ['WEBHOOK_SECRET'], message: 'is required when BOT_MODE=webhook' });
      }
    }
    // Telegram only opens Mini Apps over https. Plain http is tolerated against a mock API root (local dev).
    if (!env.MINI_APP_URL.startsWith('https://') && env.TELEGRAM_API_ROOT === DEFAULT_API_ROOT) {
      ctx.addIssue({ code: 'custom', path: ['MINI_APP_URL'], message: 'must be an https URL' });
    }
  });

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface BotConfig {
  botToken: string;
  telegramApiRoot: string;
  internalSecret: string;
  serverInternalUrl: string;
  internalPort: number;
  internalHost: string;
  miniAppUrl: string;
  mode: 'polling' | 'webhook';
  /** Full public URL Telegram posts updates to (webhook mode only). */
  webhookUrl?: string;
  webhookSecret?: string;
  supportContact: string;
  broadcastRps: number;
  logLevel: LogLevel;
}

export const WEBHOOK_PATH = '/telegram/webhook';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Validates the environment. The thrown message names the offending variables but never their values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): BotConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const key = String(issue.path[0] ?? 'environment');
      const present = env[key] !== undefined && env[key] !== '';
      if (!present) return `  ${key}: is required`;
      // Never echo anything derived from a secret value.
      if (SECRET_KEYS.has(key)) return `  ${key}: is invalid`;
      return `  ${key}: ${issue.message}`;
    });
    throw new ConfigError(`Invalid bot configuration:\n${[...new Set(lines)].join('\n')}`);
  }
  const value = parsed.data;
  let webhookUrl = value.WEBHOOK_URL;
  if (webhookUrl !== undefined && new URL(webhookUrl).pathname === '/') {
    // A bare origin is accepted for convenience: the bot always serves the webhook at WEBHOOK_PATH.
    webhookUrl = `${webhookUrl}${WEBHOOK_PATH}`;
  }
  return {
    botToken: value.BOT_TOKEN,
    telegramApiRoot: value.TELEGRAM_API_ROOT,
    internalSecret: value.INTERNAL_SECRET,
    serverInternalUrl: value.SERVER_INTERNAL_URL,
    internalPort: value.BOT_INTERNAL_PORT,
    internalHost: value.BOT_INTERNAL_HOST,
    miniAppUrl: value.MINI_APP_URL,
    mode: value.BOT_MODE,
    webhookUrl,
    webhookSecret: value.WEBHOOK_SECRET,
    supportContact: value.SUPPORT_CONTACT,
    broadcastRps: value.BROADCAST_RPS,
    logLevel: value.LOG_LEVEL,
  };
}
