import { loadConfig } from '../config';
import { seedDev } from '../seed';
import { connect } from './index';

const config = loadConfig();
const handle = await connect(config.databaseUrl);
await seedDev({ db: handle.db, config, now: Date.now, bot: null });
await handle.close();
console.info('seed done');
