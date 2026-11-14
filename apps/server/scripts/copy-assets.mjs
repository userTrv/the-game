// Copies SQL migrations next to the bundled server so dist/ is self-contained.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../drizzle', import.meta.url));
const to = fileURLToPath(new URL('../dist/drizzle', import.meta.url));
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
