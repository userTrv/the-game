import { createMockTelegram } from './index';

/**
 * Standalone mock Telegram Bot API server.
 *
 *   MOCK_TG_PORT        port to listen on (default 8081)
 *   MOCK_TG_HOST        host to bind to (default 127.0.0.1; use 0.0.0.0 inside containers)
 *   MOCK_TG_PUBLIC_URL  base URL used in invoice links (default http://127.0.0.1:<port>)
 *   MOCK_TG_TOKEN       when set, only this bot token is accepted
 *   MOCK_TG_LOG         "1" enables request logging
 */
async function main(): Promise<void> {
  const port = Number(process.env.MOCK_TG_PORT ?? 8081);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('MOCK_TG_PORT must be a port number');
  }
  const mock = createMockTelegram({
    host: process.env.MOCK_TG_HOST ?? '127.0.0.1',
    publicUrl: process.env.MOCK_TG_PUBLIC_URL || undefined,
    token: process.env.MOCK_TG_TOKEN || undefined,
    logger: process.env.MOCK_TG_LOG === '1',
  });
  const url = await mock.listen(port);
  console.info(`mock-telegram: listening on ${url} (TELEGRAM_API_ROOT=${url})`);

  const shutdown = (): void => {
    mock.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('mock-telegram: failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
