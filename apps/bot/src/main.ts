import { ALLOWED_UPDATES, createBot } from './bot';
import { ConfigError, loadConfig } from './config';
import type { BotConfig } from './config';
import { createInternalServer } from './internal-server';
import { createLogger, describeError } from './logger';
import { createOutboxWorker } from './outbox';
import { createHttpServerClient } from './server-client';

const SHUTDOWN_TIMEOUT_MS = 15_000;

function readConfig(): BotConfig {
  try {
    return loadConfig();
  } catch (error) {
    // The message lists variable names only, never values.
    console.error(error instanceof ConfigError ? error.message : 'Invalid bot configuration');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  const logger = createLogger({
    level: config.logLevel,
    redact: [config.botToken, config.internalSecret, config.webhookSecret ?? ''],
  });
  if (config.internalSecret.length < 16) {
    logger.warn('INTERNAL_SECRET is short; use at least 16 random characters outside of local development');
  }

  const server = createHttpServerClient({
    baseUrl: config.serverInternalUrl,
    secret: config.internalSecret,
    logger: logger.child({ scope: 'server-client' }),
  });
  const { bot, setupProfile } = createBot(config, { server, logger: logger.child({ scope: 'bot' }) });
  const http = createInternalServer(config, { bot, logger: logger.child({ scope: 'http' }) });
  const outbox = createOutboxWorker({
    api: bot.api,
    server,
    logger: logger.child({ scope: 'outbox' }),
    rps: config.broadcastRps,
  });

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { reason });
    const force = setTimeout(() => {
      logger.error('shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    try {
      // Stop claiming and flush reports first, then stop taking updates, then drop the HTTP server.
      await outbox.stop();
      await bot.stop();
      await http.close();
    } catch (error) {
      logger.error('shutdown failed', describeError(error));
      exitCode = 1;
    }
    process.exit(exitCode);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.once('SIGINT', () => void shutdown('SIGINT', 0));

  await http.listen({ port: config.internalPort, host: config.internalHost });
  logger.info('internal http server listening', { host: config.internalHost, port: config.internalPort });

  await bot.init();
  logger.info('bot initialized', { username: bot.botInfo.username, mode: config.mode });
  try {
    await setupProfile();
  } catch (error) {
    logger.warn('could not register commands and menu button', describeError(error));
  }

  if (config.mode === 'webhook') {
    await bot.api.setWebhook(config.webhookUrl ?? '', {
      secret_token: config.webhookSecret,
      allowed_updates: ALLOWED_UPDATES,
    });
    logger.info('webhook registered');
  } else {
    bot
      .start({
        allowed_updates: ALLOWED_UPDATES,
        onStart: () => logger.info('long polling started'),
      })
      .catch((error: unknown) => {
        logger.error('long polling stopped unexpectedly', describeError(error));
        void shutdown('polling failure', 1);
      });
  }

  outbox.start();
  logger.info('outbox worker started', { rps: config.broadcastRps });
}

main().catch((error: unknown) => {
  console.error('bot failed to start:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
