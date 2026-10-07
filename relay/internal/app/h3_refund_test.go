package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/store"
	"github.com/cheapbuddy/relay/internal/upstream"
)

type refundStore struct {
	mu      sync.Mutex
	request store.MediaRequest
	markErr bool
	created bool
}

func (f *refundStore) CreateMediaRequest(_ context.Context, request store.MediaRequest) (bool, error) {
	f.request = request
	f.created = true
	f.request.BillingStatus = "reserved"
	return true, nil
}

func (f *refundStore) DecideMediaBilling(_ context.Context, _ string, status string, quota int64, bill, reason string) (bool, error) {
	if f.markErr {
		f.markErr = false
		return false, errors.New("decision write failed")
	}
	if h3Terminal(f.request.BillingStatus) || f.request.BillingStatus == "capture_pending" || f.request.BillingStatus == "release_pending" {
		return false, nil
	}
	f.request.BillingStatus = status
	f.request.FinalQuota = quota
	f.request.NativeBillID = bill
	f.request.LastError = reason
	return true, nil
}

func TestH3ReserveIntentPrecedesWalletCall(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusPaymentRequired, http.StatusGatewayTimeout} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			f := &refundStore{}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !f.created {
					t.Error("wallet called before durable request")
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"billing_request_id":"batch_image_hold:reserve1"}`))
			}))
			defer srv.Close()
			s := &Server{Config: config.Config{Sub2APIURL: srv.URL, Sub2APITimeout: time.Second}, Upstream: upstream.New(time.Second)}
			err := s.prepareH3Reservation(context.Background(), f, store.MediaRequest{RequestID: "reserve1", CheapBuddyUserID: 40, APIKeyID: 46, Model: "MiniMax-H3", ReservationAmount: 30800})
			if (err != nil) != (status != http.StatusOK) {
				t.Fatalf("reserve err=%v", err)
			}
			want := "reserved"
			if status == http.StatusPaymentRequired {
				want = "released"
			}
			if status == http.StatusGatewayTimeout {
				want = "pending_reconciliation"
			}
			if f.request.BillingStatus != want {
				t.Fatalf("state=%s want=%s", f.request.BillingStatus, want)
			}
		})
	}
}

func TestH3UncertainTerminalDecisionNeverSwitchesOperation(t *testing.T) {
	for _, decision := range []string{"capture_pending", "release_pending"} {
		t.Run(decision, func(t *testing.T) {
			f := &refundStore{request: store.MediaRequest{RequestID: "retry1", Model: "MiniMax-H3", APIKeyID: 46, CheapBuddyUserID: 40, BillingStatus: decision, ReservationAmount: 30800, FinalQuota: 30800, CreatedAt: time.Now().Add(-time.Hour)}}
			var calls []string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				op := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
				calls = append(calls, op)
				if len(calls) == 1 {
					w.WriteHeader(http.StatusGatewayTimeout)
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"billing_request_id": "batch_image_" + op + ":retry1"})
			}))
			defer srv.Close()
			s := &Server{Config: config.Config{Sub2APIURL: srv.URL, Sub2APITimeout: time.Second, H3TaskTimeout: 30 * time.Minute}, Upstream: upstream.New(time.Second)}
			if err := s.reconcileH3Request(context.Background(), f, f.request); err == nil {
				t.Fatal("lost response not simulated")
			}
			if f.request.BillingStatus != decision {
				t.Fatal("lost durable billing decision")
			}
			if err := s.reconcileH3Request(context.Background(), f, f.request); err != nil {
				t.Fatal(err)
			}
			if len(calls) != 2 || calls[0] != calls[1] {
				t.Fatalf("opposite retry=%v", calls)
			}
		})
	}
}

func TestH3ReleaseAcknowledgementAndCAS(t *testing.T) {
	for _, tc := range []struct {
		name, state              string
		malformed, decisionError bool
		want                     string
		wantErr                  bool
		calls                    int
	}{
		{"confirmed reject", "submitted", false, false, "released", false, 1},
		{"bad acknowledgement", "submitted", true, false, "release_pending", true, 1},
		{"decision write fails", "submitted", false, true, "submitted", true, 0},
		{"settled is not refunded", "settled", false, false, "settled", false, 0},
		{"released stays released", "released", false, false, "released", false, 0},
		{"capture decision cannot refund", "capture_pending", false, false, "capture_pending", false, 0},
		{"release decision retries", "release_pending", false, false, "released", false, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &refundStore{request: store.MediaRequest{RequestID: "reject1", Model: "MiniMax-H3", APIKeyID: 46, CheapBuddyUserID: 40, BillingStatus: tc.state, ReservationAmount: 30800}, markErr: tc.decisionError}
			calls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if tc.malformed {
					_, _ = w.Write([]byte(`{}`))
					return
				}
				_, _ = w.Write([]byte(`{"billing_request_id":"batch_image_release:reject1"}`))
			}))
			defer srv.Close()
			s := &Server{Config: config.Config{Sub2APIURL: srv.URL, Sub2APITimeout: time.Second}, Upstream: upstream.New(time.Second)}
			err := s.releaseH3Request(context.Background(), f, "reject1", "confirmed rejection")
			if (err != nil) != tc.wantErr || f.request.BillingStatus != tc.want || calls != tc.calls {
				t.Fatalf("err=%v state=%s calls=%d", err, f.request.BillingStatus, calls)
			}
		})
	}
}

func (f *refundStore) WithMediaBillingLock(ctx context.Context, _ string, fn func(context.Context) error) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return fn(ctx)
}
func (f *refundStore) FindMediaRequest(context.Context, string) (store.MediaRequest, bool, error) {
	return f.request, true, nil
}
func (f *refundStore) FindMapping(context.Context, int64) (store.Mapping, bool, error) {
	return store.Mapping{NewAPIUserID: 4}, true, nil
}
func (f *refundStore) MarkBilling(_ context.Context, _ string, status string, _ int64, _, _, reason string) error {
	if f.markErr {
		f.markErr = false
		return errors.New("temporary store failure")
	}
	f.request.BillingStatus = status
	f.request.LastError = reason
	return nil
}

func TestH3ReservationLifecycle(t *testing.T) {
	now := time.Date(2026, 10, 7, 15, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name, status string
		age          time.Duration
		bill         bool
		taskID       bool
		want         string
	}{
		{"queued bill is not success", "QUEUED", time.Minute, true, true, "submitted"},
		{"running bill is not success", "IN_PROGRESS", time.Minute, true, true, "submitted"},
		{"failed with bill", "FAILURE", time.Minute, true, true, "released"},
		{"failed without bill", "FAILURE", time.Minute, false, true, "released"},
		{"success settles", "SUCCESS", time.Minute, true, true, "settled"},
		{"success waits for bill", "SUCCESS", time.Minute, false, true, "submitted"},
		{"no IDs expire", "", 31 * time.Minute, false, false, "released"},
		{"no IDs not expired", "", 29 * time.Minute, false, false, "submitted"},
		{"running expires", "IN_PROGRESS", 31 * time.Minute, true, true, "released"},
		{"timeout boundary", "QUEUED", 30 * time.Minute, false, true, "released"},
		{"late success does not charge", "SUCCESS", 31 * time.Minute, true, true, "released"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &refundStore{request: store.MediaRequest{RequestID: "relay1", APIKeyID: 46, CheapBuddyUserID: 40, Model: "MiniMax-H3", ReservationAmount: 30800, BillingStatus: "submitted", CreatedAt: now.Add(-tc.age)}}
			if tc.taskID {
				f.request.NativeTaskID = "task1"
				f.request.NewAPIRequestID = "native1"
			}
			var operations []string
			var bills int
			ledger := map[string]bool{}
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.URL.Path == "/api/task":
					_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"items": []any{map[string]any{"task_id": "task1", "user_id": 4, "status": tc.status, "admin_info": map[string]any{"request_id": "native1"}}}}})
				case r.URL.Path == "/api/log/":
					bills++
					items := []any{}
					if tc.bill {
						items = append(items, map[string]any{"id": 124, "request_id": "native1", "quota": 120000, "type": 2, "user_id": 4})
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": map[string]any{"items": items}})
				case strings.Contains(r.URL.Path, "/billing/"):
					op := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
					if !ledger[op] {
						operations = append(operations, op)
						ledger[op] = true
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"billing_request_id": "batch_image_" + op + ":relay1"})
				default:
					t.Error("unexpected path")
				}
			}))
			defer srv.Close()
			s := &Server{Config: config.Config{H3TaskTimeout: 30 * time.Minute, NewAPITimeout: time.Second, Sub2APITimeout: time.Second, NewAPIURL: srv.URL, Sub2APIURL: srv.URL, NewAPILogPath: "/api/log/", MediaMultiplierByModel: map[string]float64{"MiniMax-H3": 0.2566666666}}, Upstream: upstream.New(time.Second), clock: func() time.Time { return now }}
			if err := s.reconcileH3Request(context.Background(), f, f.request); err != nil {
				t.Fatal(err)
			}
			if f.request.BillingStatus != tc.want {
				t.Fatalf("state=%s want=%s", f.request.BillingStatus, tc.want)
			}
			if tc.want == "released" || tc.want == "settled" {
				if len(operations) != 1 {
					t.Fatalf("billing operations=%v", operations)
				}
				if err := s.reconcileH3Request(context.Background(), f, f.request); err != nil {
					t.Fatal(err)
				}
				if len(operations) != 1 {
					t.Fatal("terminal request billed twice")
				}
			} else if len(operations) != 0 {
				t.Fatalf("premature billing=%v", operations)
			}
			if tc.status != "SUCCESS" && bills != 0 {
				t.Fatal("queried bill before task success")
			}
		})
	}
}

func TestReleasedH3ReplayIsNotAcceptedUnknown(t *testing.T) {
	w := httptest.NewRecorder()
	s := &Server{}
	s.writeMediaReplay(w, httptest.NewRequest(http.MethodPost, "/v1/videos", nil), store.MediaRequest{RequestID: "old", Model: "MiniMax-H3", BillingStatus: "released", LastError: "H3 task deadline exceeded; reservation released"})
	if w.Code != http.StatusGone || strings.Contains(w.Body.String(), "accepted_unknown") {
		t.Fatalf("replay=%d %s", w.Code, w.Body.String())
	}
}

func TestH3CaptureDecisionRecoversPersistedAmountAfterLostResponse(t *testing.T) {
	now := time.Now()
	f := &refundStore{request: store.MediaRequest{RequestID: "capture1", Model: "MiniMax-H3", APIKeyID: 46, CheapBuddyUserID: 40, NativeTaskID: "task1", NewAPIRequestID: "native1", ReservationAmount: 30800, BillingStatus: "submitted", CreatedAt: now}}
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/task":
			_, _ = w.Write([]byte(`{"data":{"items":[{"task_id":"task1","user_id":4,"status":"SUCCESS","admin_info":{"request_id":"native1"}}]}}`))
		case "/api/log/":
			_, _ = w.Write([]byte(`{"data":{"items":[{"id":124,"request_id":"native1","user_id":4,"type":2,"quota":120000}]}}`))
		case "/api/internal/cheapbuddy/billing/capture":
			calls++
			var payload map[string]any
			_ = json.NewDecoder(r.Body).Decode(&payload)
			if payload["actual_amount"] != float64(30800) || f.request.BillingStatus != "capture_pending" || f.request.NativeBillID != "124" {
				t.Error("missing durable amount/bill before capture")
			}
			if calls == 1 {
				w.WriteHeader(504)
				return
			}
			_, _ = w.Write([]byte(`{"billing_request_id":"batch_image_capture:capture1"}`))
		default:
			t.Error("unexpected operation")
		}
	}))
	defer srv.Close()
	s := &Server{Config: config.Config{H3TaskTimeout: 30 * time.Minute, NewAPIURL: srv.URL, Sub2APIURL: srv.URL, NewAPITimeout: time.Second, Sub2APITimeout: time.Second, NewAPILogPath: "/api/log/", MediaMultiplierByModel: map[string]float64{"MiniMax-H3": 0.2566666666}}, Upstream: upstream.New(time.Second), clock: func() time.Time { return now }}
	if err := s.reconcileH3Request(context.Background(), f, f.request); err == nil {
		t.Fatal("expected lost response")
	}
	s.clock = func() time.Time { return now.Add(time.Hour) }
	if err := s.reconcileH3Request(context.Background(), f, f.request); err != nil {
		t.Fatal(err)
	}
	if f.request.BillingStatus != "settled" || calls != 2 {
		t.Fatalf("state=%s capture calls=%d", f.request.BillingStatus, calls)
	}
}
