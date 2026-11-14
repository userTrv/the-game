import { GrammyError, HttpError } from 'grammy';
import type { LogLevel } from './config';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface LoggerOptions {
  level: LogLevel;
  /** Secret strings that are replaced with `[redacted]` if they ever end up in a log line. */
  redact?: string[];
  /** Where to write; defaults to stdout. */
  write?: (line: string) => void;
}

/** A tiny structured logger: one JSON object per line on stdout. */
export function createLogger(options: LoggerOptions, bindings: LogFields = {}): Logger {
  const threshold = LEVELS[options.level];
  const secrets = (options.redact ?? []).filter((secret) => secret.length >= 6);
  const write = options.write ?? ((line: string) => void process.stdout.write(line));

  const log = (level: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void => {
    if (LEVELS[level] < threshold) return;
    let line: string;
    try {
      line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...bindings, ...fields });
    } catch {
      line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, logError: 'unserializable fields' });
    }
    for (const secret of secrets) line = line.split(secret).join('[redacted]');
    write(`${line}\n`);
  };

  return {
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
    child: (extra) => createLogger(options, { ...bindings, ...extra }),
  };
}

export const silentLogger: Logger = createLogger({ level: 'silent' });

/** A log-safe description of an error (no payloads, no stack traces with request data). */
export function describeError(error: unknown): LogFields {
  if (error instanceof GrammyError) {
    return { error: error.description, errorCode: error.error_code, method: error.method };
  }
  if (error instanceof HttpError) {
    return { error: error.message };
  }
  if (error instanceof Error) {
    const extra = error as Error & { kind?: unknown; status?: unknown };
    return {
      error: error.message,
      errorName: error.name,
      ...(typeof extra.kind === 'string' ? { kind: extra.kind } : {}),
      ...(typeof extra.status === 'number' ? { status: extra.status } : {}),
    };
  }
  return { error: String(error) };
}
