import pg from 'pg';

const { Pool } = pg;

export const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE SCHEMA IF NOT EXISTS cheapbuddy_integration;
    CREATE TABLE IF NOT EXISTS cheapbuddy_integration.schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cheapbuddy_integration.user_mappings (
      cheapbuddy_user_id bigint PRIMARY KEY,
      sub2api_api_key_id bigint NOT NULL,
      newapi_user_id bigint,
      newapi_token_ciphertext text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cheapbuddy_integration.media_requests (
      request_id text PRIMARY KEY,
      cheapbuddy_user_id bigint NOT NULL,
      api_key_id bigint NOT NULL,
      native_task_id text,
      reservation_id text NOT NULL,
      reservation_amount bigint NOT NULL DEFAULT 0,
      native_bill_id text,
      billing_status text NOT NULL DEFAULT 'reserved',
      final_quota bigint,
      ledger_transaction_id text,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS media_requests_native_task_idx
      ON cheapbuddy_integration.media_requests (native_task_id)
      WHERE native_task_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS media_requests_pending_idx
      ON cheapbuddy_integration.media_requests (billing_status, updated_at);
  `,
}];

export function createPool(databaseUrl) {
  return new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30_000 });
}

export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS cheapbuddy_integration');
    await client.query('CREATE TABLE IF NOT EXISTS cheapbuddy_integration.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const migration of MIGRATIONS) {
      const existing = await client.query('SELECT 1 FROM cheapbuddy_integration.schema_migrations WHERE version = $1', [migration.version]);
      if (existing.rowCount) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO cheapbuddy_integration.schema_migrations(version) VALUES ($1)', [migration.version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
}
