package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/store"
	"github.com/cheapbuddy/relay/internal/upstream"
)

func TestH3DeadlineRefundWithRealDurableStore(t *testing.T) {
	databaseURL := os.Getenv("RELAY_STORE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("isolated PostgreSQL not configured")
	}
	ctx := context.Background()
	durable, err := store.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer durable.Close()
	if err := durable.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	id := "h3-refund-integration-" + time.Now().Format("150405.000000000")
	request := store.MediaRequest{RequestID: id, IdempotencyKey: id, APIKeyID: 46, CheapBuddyUserID: 40, Model: "MiniMax-H3", ReservationID: id, ReservationAmount: 1000000}
	if created, err := durable.CreateMediaRequest(ctx, request); err != nil || !created {
		t.Fatalf("create=%v %v", created, err)
	}
	t.Cleanup(func() {
		_, _ = durable.Pool.Exec(ctx, `DELETE FROM cheapbuddy_integration.media_requests WHERE request_id=$1`, id)
	})
	if _, err := durable.Pool.Exec(ctx, `UPDATE cheapbuddy_integration.media_requests SET created_at=now()-interval '1 hour',billing_status='pending_reconciliation' WHERE request_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/billing/release") {
			t.Error("non-refund operation")
		}
		posts++
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["request_id"] != id || body["amount"] != float64(1000000) {
			t.Error("refund identity or amount changed")
		}
		state, _, err := durable.FindMediaRequest(ctx, id)
		if err != nil || state.BillingStatus != "release_pending" {
			t.Error("decision was not durable before remote call")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"billing_request_id": "batch_image_release:" + id})
	}))
	defer srv.Close()
	s := &Server{Config: config.Config{H3TaskTimeout: 30 * time.Minute, Sub2APITimeout: time.Second, Sub2APIURL: srv.URL}, Upstream: upstream.New(time.Second)}
	if err := s.reconcileH3Request(ctx, durable, request); err != nil {
		t.Fatal(err)
	}
	if err := s.reconcileH3Request(ctx, durable, request); err != nil {
		t.Fatal(err)
	}
	state, _, err := durable.FindMediaRequest(ctx, id)
	if err != nil || state.BillingStatus != "released" || posts != 1 {
		t.Fatalf("state=%s posts=%d err=%v", state.BillingStatus, posts, err)
	}
}
