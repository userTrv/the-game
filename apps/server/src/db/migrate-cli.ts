import { loadConfig } from '../config';
import { connect } from './index';

// Applies pending migrations and exits. `connect` runs them as part of connecting.
const handle = await connect(loadConfig().databaseUrl);
await handle.close();
console.info('migrations applied');
