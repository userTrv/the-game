import { buildApp } from './app';
import { loadConfig } from './config';
import { connect } from './db';
import { startJobs } from './jobs';
import { seedDev } from './seed';
import { httpBotClient } from './shop';

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = await connect(config.databaseUrl);
  const bot = config.botInternalUrl ? httpBotClient(config.botInternalUrl, config.internalSecret) : null;
  const app = buildApp({ db: handle.db, config, bot });
  // Bot ghosts and a default schedule make a fresh database playable right away.
  await seedDev(app.ctx);
  const stopJobs = startJobs(app.ctx, (err) => app.log.error({ err }, 'job failed'));
  await app.listen({ port: config.port, host: config.host });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    stopJobs();
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
