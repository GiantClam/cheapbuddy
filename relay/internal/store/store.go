package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ Pool *pgxpool.Pool }

type Mapping struct {
	CheapBuddyUserID      int64
	Sub2APIAPIKeyID       int64
	NewAPIUserID          int64
	NewAPITokenCiphertext string
}

type MediaRequest struct {
	RequestID         string
	IdempotencyKey    string
	RequestHash       string
	Model             string
	CheapBuddyUserID  int64
	APIKeyID          int64
	NativeTaskID      string
	ProviderTaskID    string
	NewAPIRequestID   string
	ReservationID     string
	ReservationAmount int64
	BillingStatus     string
	FinalQuota        int64
	NativeBillID      string
	LedgerTransaction string
	LastError         string
}

type MediaUsageStat struct {
	Model       string
	Requests    int64
	BilledQuota int64
}

var migrations = []string{
	`CREATE SCHEMA IF NOT EXISTS cheapbuddy_integration;
	 CREATE TABLE IF NOT EXISTS cheapbuddy_integration.schema_migrations (
	   version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
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
	   ON cheapbuddy_integration.media_requests (native_task_id) WHERE native_task_id IS NOT NULL;
	 CREATE INDEX IF NOT EXISTS media_requests_pending_idx
	   ON cheapbuddy_integration.media_requests (billing_status, updated_at);`,
	`ALTER TABLE cheapbuddy_integration.media_requests
	   ADD COLUMN IF NOT EXISTS idempotency_key text;
	 CREATE UNIQUE INDEX IF NOT EXISTS media_requests_idempotency_idx
	   ON cheapbuddy_integration.media_requests (api_key_id, idempotency_key)
	   WHERE idempotency_key IS NOT NULL;
	 CREATE INDEX IF NOT EXISTS media_requests_user_task_idx
	   ON cheapbuddy_integration.media_requests (cheapbuddy_user_id, native_task_id)
	   WHERE native_task_id IS NOT NULL;`,
	`ALTER TABLE cheapbuddy_integration.media_requests
	   ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';`,
	`ALTER TABLE cheapbuddy_integration.media_requests
	   ADD COLUMN IF NOT EXISTS newapi_request_id text;
	 CREATE UNIQUE INDEX IF NOT EXISTS media_requests_newapi_request_idx
	   ON cheapbuddy_integration.media_requests (newapi_request_id)
	   WHERE newapi_request_id IS NOT NULL;`,
	`ALTER TABLE cheapbuddy_integration.media_requests
	   ADD COLUMN IF NOT EXISTS request_hash text;
	 ALTER TABLE cheapbuddy_integration.media_requests
	   ADD COLUMN IF NOT EXISTS provider_task_id text;
	 CREATE UNIQUE INDEX IF NOT EXISTS media_requests_provider_task_idx
	   ON cheapbuddy_integration.media_requests (provider_task_id)
	   WHERE provider_task_id IS NOT NULL;`,
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	return &Store{Pool: pool}, nil
}

func (s *Store) Close() { s.Pool.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.Pool.Ping(ctx) }

func (s *Store) Migrate(ctx context.Context) error {
	for index, sql := range migrations {
		version := index + 1
		var existing int
		err := s.Pool.QueryRow(ctx, `SELECT version FROM cheapbuddy_integration.schema_migrations WHERE version=$1`, version).Scan(&existing)
		if err == nil {
			continue
		}
		if err != pgx.ErrNoRows && version != 1 {
			return fmt.Errorf("read migration %d: %w", version, err)
		}
		if version == 1 {
			if _, err := s.Pool.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS cheapbuddy_integration; CREATE TABLE IF NOT EXISTS cheapbuddy_integration.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
				return fmt.Errorf("prepare migrations: %w", err)
			}
			if err := s.Pool.QueryRow(ctx, `SELECT version FROM cheapbuddy_integration.schema_migrations WHERE version=$1`, version).Scan(&existing); err == nil {
				continue
			}
		}
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, sql); err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO cheapbuddy_integration.schema_migrations(version) VALUES($1)`, version)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %d: %w", version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) FindMapping(ctx context.Context, userID int64) (Mapping, bool, error) {
	row := s.Pool.QueryRow(ctx, `SELECT cheapbuddy_user_id, sub2api_api_key_id, COALESCE(newapi_user_id, 0), COALESCE(newapi_token_ciphertext, '') FROM cheapbuddy_integration.user_mappings WHERE cheapbuddy_user_id=$1`, userID)
	var mapping Mapping
	if err := row.Scan(&mapping.CheapBuddyUserID, &mapping.Sub2APIAPIKeyID, &mapping.NewAPIUserID, &mapping.NewAPITokenCiphertext); err != nil {
		if err == pgx.ErrNoRows {
			return Mapping{}, false, nil
		}
		return Mapping{}, false, err
	}
	return mapping, mapping.NewAPIUserID > 0 && mapping.NewAPITokenCiphertext != "", nil
}

func (s *Store) SaveMapping(ctx context.Context, mapping Mapping) (Mapping, error) {
	row := s.Pool.QueryRow(ctx, `INSERT INTO cheapbuddy_integration.user_mappings (cheapbuddy_user_id, sub2api_api_key_id, newapi_user_id, newapi_token_ciphertext)
	 VALUES ($1,$2,$3,$4)
	 ON CONFLICT (cheapbuddy_user_id) DO UPDATE SET sub2api_api_key_id=EXCLUDED.sub2api_api_key_id, newapi_user_id=EXCLUDED.newapi_user_id, newapi_token_ciphertext=EXCLUDED.newapi_token_ciphertext, updated_at=now()
	 RETURNING cheapbuddy_user_id, sub2api_api_key_id, newapi_user_id, newapi_token_ciphertext`, mapping.CheapBuddyUserID, mapping.Sub2APIAPIKeyID, mapping.NewAPIUserID, mapping.NewAPITokenCiphertext)
	var saved Mapping
	if err := row.Scan(&saved.CheapBuddyUserID, &saved.Sub2APIAPIKeyID, &saved.NewAPIUserID, &saved.NewAPITokenCiphertext); err != nil {
		return Mapping{}, err
	}
	return saved, nil
}

func (s *Store) FindMediaByIdempotency(ctx context.Context, apiKeyID int64, key string) (MediaRequest, bool, error) {
	if key == "" {
		return MediaRequest{}, false, nil
	}
	return s.findMedia(ctx, `WHERE api_key_id=$1 AND idempotency_key=$2`, apiKeyID, key)
}

func (s *Store) CreateMediaRequest(ctx context.Context, request MediaRequest) (bool, error) {
	command, err := s.Pool.Exec(ctx, `INSERT INTO cheapbuddy_integration.media_requests (request_id, idempotency_key, request_hash, model, cheapbuddy_user_id, api_key_id, reservation_id, reservation_amount, billing_status)
	 VALUES($1,NULLIF($2,''),NULLIF($3,''),$4,$5,$6,$7,$8,'reserved') ON CONFLICT DO NOTHING`, request.RequestID, request.IdempotencyKey, request.RequestHash, request.Model, request.CheapBuddyUserID, request.APIKeyID, request.ReservationID, request.ReservationAmount)
	return command.RowsAffected() == 1, err
}

func (s *Store) AttachNativeTask(ctx context.Context, requestID, taskID string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE cheapbuddy_integration.media_requests SET native_task_id=$2, billing_status='submitted', updated_at=now() WHERE request_id=$1`, requestID, taskID)
	return err
}

func (s *Store) AttachProviderTask(ctx context.Context, requestID, taskID string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE cheapbuddy_integration.media_requests SET provider_task_id=$2, updated_at=now() WHERE request_id=$1`, requestID, taskID)
	return err
}

func (s *Store) AttachNewAPIRequestID(ctx context.Context, requestID, newAPIRequestID string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE cheapbuddy_integration.media_requests SET newapi_request_id=$2, billing_status='submitted', updated_at=now() WHERE request_id=$1`, requestID, newAPIRequestID)
	return err
}

func (s *Store) MarkBilling(ctx context.Context, requestID, status string, finalQuota int64, billID, ledgerID, lastError string) error {
	_, err := s.Pool.Exec(ctx, `UPDATE cheapbuddy_integration.media_requests SET billing_status=$2, final_quota=COALESCE(NULLIF($3,0), final_quota), native_bill_id=COALESCE(NULLIF($4,''), native_bill_id), ledger_transaction_id=COALESCE(NULLIF($5,''), ledger_transaction_id), last_error=NULLIF($6,''), updated_at=now() WHERE request_id=$1`, requestID, status, finalQuota, billID, ledgerID, lastError)
	return err
}

func (s *Store) PendingRequests(ctx context.Context, limit int) ([]MediaRequest, error) {
	rows, err := s.Pool.Query(ctx, `SELECT request_id, COALESCE(idempotency_key,''), COALESCE(request_hash,''), model, cheapbuddy_user_id, api_key_id, COALESCE(native_task_id,''), COALESCE(provider_task_id,''), COALESCE(newapi_request_id,''), reservation_id, reservation_amount, billing_status, COALESCE(final_quota,0), COALESCE(native_bill_id,''), COALESCE(ledger_transaction_id,''), COALESCE(last_error,'') FROM cheapbuddy_integration.media_requests WHERE billing_status IN ('reserved','submitted','pending_reconciliation') ORDER BY updated_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MediaRequest{}
	for rows.Next() {
		var request MediaRequest
		if err := rows.Scan(&request.RequestID, &request.IdempotencyKey, &request.RequestHash, &request.Model, &request.CheapBuddyUserID, &request.APIKeyID, &request.NativeTaskID, &request.ProviderTaskID, &request.NewAPIRequestID, &request.ReservationID, &request.ReservationAmount, &request.BillingStatus, &request.FinalQuota, &request.NativeBillID, &request.LedgerTransaction, &request.LastError); err != nil {
			return nil, err
		}
		result = append(result, request)
	}
	return result, rows.Err()
}

func (s *Store) TaskBelongsToUser(ctx context.Context, userID int64, taskID string) (bool, error) {
	var found bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM cheapbuddy_integration.media_requests WHERE cheapbuddy_user_id=$1 AND (native_task_id=$2 OR provider_task_id=$2))`, userID, taskID).Scan(&found)
	return found, err
}

func (s *Store) MediaUsageByUser(ctx context.Context, userID int64, start, end time.Time) ([]MediaUsageStat, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT model, COUNT(*), COALESCE(SUM(final_quota), 0)::bigint
		FROM cheapbuddy_integration.media_requests
		WHERE cheapbuddy_user_id=$1
		  AND created_at >= $2
		  AND created_at < $3
		  AND billing_status = 'settled'
		GROUP BY model
		ORDER BY COUNT(*) DESC, model ASC`, userID, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []MediaUsageStat{}
	for rows.Next() {
		var stat MediaUsageStat
		if err := rows.Scan(&stat.Model, &stat.Requests, &stat.BilledQuota); err != nil {
			return nil, err
		}
		result = append(result, stat)
	}
	return result, rows.Err()
}

func (s *Store) findMedia(ctx context.Context, clause string, args ...any) (MediaRequest, bool, error) {
	query := `SELECT request_id, COALESCE(idempotency_key,''), COALESCE(request_hash,''), model, cheapbuddy_user_id, api_key_id, COALESCE(native_task_id,''), COALESCE(provider_task_id,''), COALESCE(newapi_request_id,''), reservation_id, reservation_amount, billing_status, COALESCE(final_quota,0), COALESCE(native_bill_id,''), COALESCE(ledger_transaction_id,''), COALESCE(last_error,'') FROM cheapbuddy_integration.media_requests ` + clause
	var request MediaRequest
	err := s.Pool.QueryRow(ctx, query, args...).Scan(&request.RequestID, &request.IdempotencyKey, &request.RequestHash, &request.Model, &request.CheapBuddyUserID, &request.APIKeyID, &request.NativeTaskID, &request.ProviderTaskID, &request.NewAPIRequestID, &request.ReservationID, &request.ReservationAmount, &request.BillingStatus, &request.FinalQuota, &request.NativeBillID, &request.LedgerTransaction, &request.LastError)
	if err == pgx.ErrNoRows {
		return MediaRequest{}, false, nil
	}
	if err != nil {
		return MediaRequest{}, false, err
	}
	return request, true, nil
}

func ContextWithTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, timeout)
}
