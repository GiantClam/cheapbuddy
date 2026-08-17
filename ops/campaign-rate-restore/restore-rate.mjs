import process from 'node:process';
import pg from 'pg';

const groupId = Number(process.env.CAMPAIGN_GROUP_ID || 2);
const expectedMultiplier = Number(process.env.CAMPAIGN_MULTIPLIER || 0.2);
const restoreMultiplier = Number(process.env.RESTORE_MULTIPLIER || 0.6);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || !Number.isInteger(groupId) || groupId <= 0) {
  throw new Error('DATABASE_URL and a positive CAMPAIGN_GROUP_ID are required');
}

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query('BEGIN');

  const result = await client.query(
    `UPDATE groups
       SET rate_multiplier = $1,
           updated_at = NOW()
     WHERE id = $2
       AND rate_multiplier = $3
     RETURNING id, name, rate_multiplier`,
    [restoreMultiplier, groupId, expectedMultiplier],
  );

  if (result.rowCount === 1) {
    await client.query(
      `INSERT INTO scheduler_outbox (event_type, group_id, payload)
       VALUES ('group_changed', $1, NULL)`,
      [groupId],
    );
    console.log(`Restored group ${result.rows[0].id} (${result.rows[0].name}) to ${result.rows[0].rate_multiplier}x.`);
  } else {
    const current = await client.query(
      'SELECT id, name, rate_multiplier FROM groups WHERE id = $1',
      [groupId],
    );
    if (current.rowCount !== 1) {
      throw new Error(`Campaign group ${groupId} was not found`);
    }
    console.log(`No change: group ${current.rows[0].id} is already ${current.rows[0].rate_multiplier}x.`);
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
