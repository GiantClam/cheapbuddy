package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

// Use only an isolated test database: migrations create the integration schema.
func integrationStore(t *testing.T) *Store {
	t.Helper()
	databaseURL := os.Getenv("RELAY_STORE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("RELAY_STORE_TEST_DATABASE_URL is not configured")
	}
	s, err := Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return s
}

func testMediaRequest(t *testing.T, s *Store) MediaRequest {
	t.Helper()
	id := fmt.Sprintf("relay-store-test-%d", time.Now().UnixNano())
	request := MediaRequest{RequestID: id, IdempotencyKey: id, Model: "MiniMax-H3", CheapBuddyUserID: 1, APIKeyID: 1, ReservationID: id, ReservationAmount: 30800}
	inserted, err := s.CreateMediaRequest(context.Background(), request)
	if err != nil || !inserted {
		t.Fatalf("create = %v, %v", inserted, err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := s.Pool.Exec(ctx, `DELETE FROM cheapbuddy_integration.media_requests WHERE request_id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	return request
}

func TestMediaRequestCreatedAtIntegration(t *testing.T) {
	s := integrationStore(t)
	request := testMediaRequest(t, s)
	ctx := context.Background()
	byID, found, err := s.FindMediaRequest(ctx, request.RequestID)
	if err != nil || !found || byID.CreatedAt.IsZero() {
		t.Fatalf("find request = %+v, %v, %v", byID, found, err)
	}
	byKey, found, err := s.FindMediaByIdempotency(ctx, request.APIKeyID, request.IdempotencyKey)
	if err != nil || !found || !byKey.CreatedAt.Equal(byID.CreatedAt) {
		t.Fatalf("find idempotency = %+v, %v, %v", byKey, found, err)
	}
	pending, err := s.PendingRequests(ctx, 10000)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range pending {
		if row.RequestID == request.RequestID {
			if !row.CreatedAt.Equal(byID.CreatedAt) {
				t.Fatalf("pending creation time = %v", row.CreatedAt)
			}
			return
		}
	}
	t.Fatal("test request missing from pending rows")
}

func TestTerminalBillingCannotBeResurrectedIntegration(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	for _, status := range []string{"settled", "released"} {
		t.Run(status, func(t *testing.T) {
			request := testMediaRequest(t, s)
			if err := s.MarkBilling(ctx, request.RequestID, status, 30800, "bill", "ledger", "original"); err != nil {
				t.Fatal(err)
			}
			if err := s.AttachNativeTask(ctx, request.RequestID, "late-native-"+request.RequestID); err != nil {
				t.Fatal(err)
			}
			if err := s.AttachNewAPIRequestID(ctx, request.RequestID, "late-newapi-"+request.RequestID); err != nil {
				t.Fatal(err)
			}
			if err := s.MarkBilling(ctx, request.RequestID, "pending_reconciliation", 120000, "late-bill", "late-ledger", "late"); err != nil {
				t.Fatal(err)
			}
			row, found, err := s.FindMediaRequest(ctx, request.RequestID)
			if err != nil || !found || row.BillingStatus != status || row.FinalQuota != 30800 || row.NativeBillID != "bill" || row.LedgerTransaction != "ledger" || row.LastError != "original" || row.NativeTaskID != "" || row.NewAPIRequestID != "" {
				t.Fatalf("late write changed terminal state: %+v, found=%v, err=%v", row, found, err)
			}
		})
	}
}

func TestMediaBillingAdvisoryLockIntegration(t *testing.T) {
	s := integrationStore(t)
	request := testMediaRequest(t, s)
	ctx, cancel := context.WithCancel(context.Background())
	err := s.WithMediaBillingLock(ctx, request.RequestID, func(context.Context) error {
		busy := s.WithMediaBillingLock(context.Background(), request.RequestID, func(context.Context) error { t.Fatal("same request lock acquired twice"); return nil })
		if !errors.Is(busy, ErrBillingBusy) {
			t.Fatalf("competing lock = %v", busy)
		}
		if err := s.WithMediaBillingLock(context.Background(), request.RequestID+"-different", func(context.Context) error { return nil }); err != nil {
			t.Fatal(err)
		}
		cancel()
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.WithMediaBillingLock(context.Background(), request.RequestID, func(context.Context) error { return nil }); err != nil {
		t.Fatalf("lock not released after cancellation: %v", err)
	}
}

func TestBillingDecisionCannotSwitchIntegration(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	for _, tc := range []struct{ decision, opposite, terminal string }{
		{"capture_pending", "released", "settled"},
		{"release_pending", "settled", "released"},
	} {
		t.Run(tc.decision, func(t *testing.T) {
			request := testMediaRequest(t, s)
			if err := s.MarkBilling(ctx, request.RequestID, tc.decision, 30800, "bill", "", "decision"); err != nil {
				t.Fatal(err)
			}
			for _, err := range []error{
				s.AttachNativeTask(ctx, request.RequestID, "late-native-"+request.RequestID),
				s.AttachNewAPIRequestID(ctx, request.RequestID, "late-newapi-"+request.RequestID),
				s.MarkBilling(ctx, request.RequestID, tc.opposite, 120000, "opposite", "wrong", "wrong"),
				s.MarkBilling(ctx, request.RequestID, "pending_reconciliation", 120000, "opposite", "wrong", "wrong"),
			} {
				if err != nil {
					t.Fatal(err)
				}
			}
			row, found, err := s.FindMediaRequest(ctx, request.RequestID)
			if err != nil || !found || row.BillingStatus != tc.decision || row.FinalQuota != 30800 || row.NativeBillID != "bill" || row.LastError != "decision" || row.NativeTaskID != "" || row.NewAPIRequestID != "" {
				t.Fatalf("decision changed: %+v, %v, %v", row, found, err)
			}
			pending, err := s.PendingRequests(ctx, 10000)
			if err != nil {
				t.Fatal(err)
			}
			listed := false
			for _, item := range pending {
				if item.RequestID == request.RequestID {
					listed = true
				}
			}
			if !listed {
				t.Fatal("durable decision not eligible for retry")
			}
			if err := s.MarkBilling(ctx, request.RequestID, tc.decision, 0, "", "", "retry"); err != nil {
				t.Fatal(err)
			}
			if err := s.MarkBilling(ctx, request.RequestID, tc.terminal, 0, "", "ledger", ""); err != nil {
				t.Fatal(err)
			}
			row, found, err = s.FindMediaRequest(ctx, request.RequestID)
			if err != nil || !found || row.BillingStatus != tc.terminal || row.FinalQuota != 30800 || row.LedgerTransaction != "ledger" {
				t.Fatalf("terminal transition: %+v, %v, %v", row, found, err)
			}
		})
	}
}

func TestBillingConnectionDiscardIntegration(t *testing.T) {
	s := integrationStore(t)
	conn, err := s.Pool.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := (pooledBillingConnection{conn}).discard(context.Background()); err != nil {
		t.Fatal(err)
	}
	conn.Release()
	if err := s.Ping(context.Background()); err != nil {
		t.Fatalf("pool reused discarded connection: %v", err)
	}
}

func TestBillingLockCanceledAcquireIntegration(t *testing.T) {
	s := integrationStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := s.WithMediaBillingLock(ctx, "canceled", func(context.Context) error { t.Fatal("canceled lock callback ran"); return nil })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled acquire = %v", err)
	}
}

func TestDecideMediaBillingRejectsInvalidTargetIntegration(t *testing.T) {
	s := integrationStore(t)
	request := testMediaRequest(t, s)
	for _, status := range []string{"", "reserved", "settled", "released", "invalid"} {
		applied, err := s.DecideMediaBilling(context.Background(), request.RequestID, status, 30800, "bill", "invalid")
		if err == nil || applied {
			t.Fatalf("invalid target %q accepted: applied=%v err=%v", status, applied, err)
		}
	}
	row, found, err := s.FindMediaRequest(context.Background(), request.RequestID)
	if err != nil || !found || row.BillingStatus != "reserved" {
		t.Fatalf("invalid target changed row: %+v found=%v err=%v", row, found, err)
	}
}

func TestCompetingMediaBillingDecisionsHaveOneWinnerIntegration(t *testing.T) {
	s := integrationStore(t)
	request := testMediaRequest(t, s)
	type decisionResult struct {
		status  string
		applied bool
		err     error
	}
	start := make(chan struct{})
	results := make(chan decisionResult, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	for _, status := range []string{"capture_pending", "release_pending"} {
		go func() {
			ready.Done()
			<-start
			applied, err := s.DecideMediaBilling(context.Background(), request.RequestID, status, 30800, "bill", status)
			results <- decisionResult{status, applied, err}
		}()
	}
	ready.Wait()
	close(start)
	winner := ""
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.applied {
			if winner != "" {
				t.Fatalf("both decisions applied: %s and %s", winner, result.status)
			}
			winner = result.status
		}
	}
	if winner == "" {
		t.Fatal("neither decision applied")
	}
	row, found, err := s.FindMediaRequest(context.Background(), request.RequestID)
	if err != nil || !found || row.BillingStatus != winner || row.LastError != winner || row.FinalQuota != 30800 || row.NativeBillID != "bill" {
		t.Fatalf("winner not persisted: %+v found=%v err=%v", row, found, err)
	}
	if applied, err := s.DecideMediaBilling(context.Background(), request.RequestID, winner, 0, "", "retry"); err != nil || applied {
		t.Fatalf("decision retry must not reapply: %v, %v", applied, err)
	}
	if err := s.MarkBilling(context.Background(), request.RequestID, map[string]string{"capture_pending": "settled", "release_pending": "released"}[winner], 0, "", "ledger", ""); err != nil {
		t.Fatal(err)
	}
	if applied, err := s.DecideMediaBilling(context.Background(), request.RequestID, winner, 0, "", "late"); err != nil || applied {
		t.Fatalf("terminal decision reapplied: %v, %v", applied, err)
	}
}

func TestMediaBillingDecisionEligibleStatesIntegration(t *testing.T) {
	s := integrationStore(t)
	ctx := context.Background()
	for _, status := range []string{"reserved", "submitted", "pending_reconciliation"} {
		t.Run(status, func(t *testing.T) {
			request := testMediaRequest(t, s)
			if err := s.MarkBilling(ctx, request.RequestID, status, 0, "", "", ""); err != nil {
				t.Fatal(err)
			}
			if applied, err := s.DecideMediaBilling(ctx, request.RequestID, "release_pending", 0, "", "timeout"); err != nil || !applied {
				t.Fatalf("eligible %s decision: applied=%v err=%v", status, applied, err)
			}
		})
	}
}

func TestMediaBillingDecisionDatabaseErrorDoesNotApplyIntegration(t *testing.T) {
	s := integrationStore(t)
	request := testMediaRequest(t, s)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if applied, err := s.DecideMediaBilling(ctx, request.RequestID, "release_pending", 0, "", "timeout"); err == nil || applied {
		t.Fatalf("canceled database operation: applied=%v err=%v", applied, err)
	}
	row, found, err := s.FindMediaRequest(context.Background(), request.RequestID)
	if err != nil || !found || row.BillingStatus != "reserved" {
		t.Fatalf("failed decision changed row: %+v found=%v err=%v", row, found, err)
	}
}
