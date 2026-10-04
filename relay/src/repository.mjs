export class IntegrationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async findUserMapping(userId) {
    const result = await this.pool.query(
      `SELECT cheapbuddy_user_id, sub2api_api_key_id, newapi_user_id, newapi_token_ciphertext
       FROM cheapbuddy_integration.user_mappings WHERE cheapbuddy_user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async saveUserMapping(mapping) {
    const result = await this.pool.query(
      `INSERT INTO cheapbuddy_integration.user_mappings
         (cheapbuddy_user_id, sub2api_api_key_id, newapi_user_id, newapi_token_ciphertext)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cheapbuddy_user_id) DO UPDATE SET
         sub2api_api_key_id = EXCLUDED.sub2api_api_key_id,
         newapi_user_id = EXCLUDED.newapi_user_id,
         newapi_token_ciphertext = EXCLUDED.newapi_token_ciphertext,
         updated_at = now()
       RETURNING cheapbuddy_user_id, sub2api_api_key_id, newapi_user_id, newapi_token_ciphertext`,
      [mapping.cheapbuddyUserId, mapping.sub2apiApiKeyId, mapping.newapiUserId, mapping.newapiTokenCiphertext],
    );
    return result.rows[0];
  }

  async createMediaRequest(request) {
    const result = await this.pool.query(
      `INSERT INTO cheapbuddy_integration.media_requests
         (request_id, cheapbuddy_user_id, api_key_id, reservation_id, reservation_amount, billing_status)
       VALUES ($1, $2, $3, $4, $5, 'reserved')
       ON CONFLICT (request_id) DO NOTHING
       RETURNING request_id`,
      [request.requestId, request.userId, request.apiKeyId, request.reservationId, request.reservationAmount],
    );
    return result.rowCount > 0;
  }

  async attachNativeTask(requestId, taskId) {
    await this.pool.query(
      `UPDATE cheapbuddy_integration.media_requests
       SET native_task_id = $2, updated_at = now() WHERE request_id = $1`,
      [requestId, taskId],
    );
  }

  async markBilling(requestId, status, bill = {}) {
    await this.pool.query(
      `UPDATE cheapbuddy_integration.media_requests
       SET billing_status = $2, native_bill_id = COALESCE($3, native_bill_id),
           final_quota = COALESCE($4, final_quota),
           ledger_transaction_id = COALESCE($5, ledger_transaction_id),
           last_error = $6, updated_at = now() WHERE request_id = $1`,
      [requestId, status, bill.billId ?? null, bill.finalQuota ?? null, bill.ledgerTransactionId ?? null, bill.error ?? null],
    );
  }

  async pendingRequests(limit = 100) {
    const result = await this.pool.query(
      `SELECT request_id, cheapbuddy_user_id, api_key_id, native_task_id, reservation_id, billing_status
       FROM cheapbuddy_integration.media_requests
       WHERE billing_status IN ('reserved', 'pending_reconciliation')
       ORDER BY updated_at ASC LIMIT $1`,
      [limit],
    );
    return result.rows;
  }
}
