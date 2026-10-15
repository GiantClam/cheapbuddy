import { createPool, migrate } from './db.mjs';
import { loadConfig } from './config.mjs';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool);
} finally {
  await pool.end();
}
