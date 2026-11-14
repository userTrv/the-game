// One command for local development: game server (PGlite, no Docker needed), mock Telegram Bot API,
// the bot and the Vite client. Everything talks to mocks; no real tokens are required.
import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'pglite://.pglite',
  DEV_AUTH: 'true',
  // Pinned: a launcher that exports PORT for the client must not move the game server onto it.
  PORT: '3000',
  JWT_SECRET: 'dev-jwt-secret',
  BOT_TOKEN: '123456:DEV',
  INTERNAL_SECRET: 'dev-internal',
  ADS_REWARD_SECRET: 'dev-ads',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'admin',
  PUBLIC_URL: 'http://localhost:5173',
  BOT_INTERNAL_URL: 'http://localhost:8082',
  SERVER_INTERNAL_URL: 'http://localhost:3000',
  TELEGRAM_API_ROOT: 'http://localhost:8081',
  MINI_APP_URL: 'https://localhost:5173',
  SUPPORT_CONTACT: '@support',
  MOCK_TG_PORT: '8081',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
};

const procs = [
  ['server', ['--filter', '@shellter/server', 'exec', 'tsx', 'watch', 'src/main.ts']],
  ['mock-tg', ['--filter', '@shellter/mock-telegram', 'start']],
  ['bot', ['--filter', '@shellter/bot', 'exec', 'tsx', 'watch', 'src/main.ts']],
  ['client', ['--filter', '@shellter/client', 'dev']],
].map(([name, args]) => {
  const p = spawn('pnpm', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (chunk) => process.stdout.write(String(chunk).replace(/^(?=.)/gm, `[${name}] `));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  return p;
});

console.log('\n  Game:        http://localhost:5173/           (website, guest)');
console.log('  Mini App:    http://localhost:5173/?mock=tg   (mock Telegram)');
console.log('  Admin API:   http://localhost:3000/admin/api  (password: admin)\n');

const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
