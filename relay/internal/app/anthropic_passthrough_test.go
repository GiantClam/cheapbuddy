package app

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNativeAnthropicAliasesAreOpaqueSub2APIRequests(t *testing.T) {
	for _, tc := range []struct{ path, canonical string }{
		{"/v1/messages", "/v1/messages"}, {"/messages", "/v1/messages"}, {"/v1/v1/messages", "/v1/messages"},
		{"/v1/messages/count_tokens", "/v1/messages/count_tokens"}, {"/messages/count_tokens", "/v1/messages/count_tokens"}, {"/v1/v1/messages/count_tokens", "/v1/messages/count_tokens"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			payload := "  {\"model\":\"claude-sonnet-5-5\",\"tools\":[{\"name\":\"x\",\"input_schema\":{}}],\"thinking\":{\"type\":\"adaptive\"},\"unknown_beta\":{\"bytes\":\"unchanged\"}}\n"
			responseBody := "{\"type\":\"message\",\"content\":[{\"type\":\"thinking\",\"signature\":\"opaque\"}],\"usage\":{\"cache_creation_input_tokens\":8},\"future\":true}\n"
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				body, _ := io.ReadAll(r.Body)
				if string(body) != payload {
					t.Error("native business body was changed")
				}
				if r.URL.Path != tc.canonical || r.URL.RawQuery != "beta=1" {
					t.Errorf("path/query=%s?%s", r.URL.Path, r.URL.RawQuery)
				}
				if r.Header.Get("Anthropic-Version") != "2023-06-01" || r.Header.Get("Anthropic-Beta") != "future-2026" {
					t.Error("native version/beta headers changed")
				}
				if r.Header.Get("Authorization") != "Bearer same-key" {
					t.Error("existing customer Key replaced")
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusCreated)
				fmt.Fprint(w, responseBody)
			}))
			defer upstream.Close()
			cfg := claudeTextTestConfig(upstream.URL)
			req := httptest.NewRequest(http.MethodPost, tc.path+"?beta=1", strings.NewReader(payload))
			req.Header.Set("X-Api-Key", "same-key")
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Anthropic-Version", "2023-06-01")
			req.Header.Set("Anthropic-Beta", "future-2026")
			rr := httptest.NewRecorder()
			(&Server{Config: cfg}).Router().ServeHTTP(rr, req)
			if rr.Code != http.StatusCreated || rr.Body.String() != responseBody || calls != 1 {
				t.Fatalf("status=%d calls=%d body=%s", rr.Code, calls, rr.Body.String())
			}
		})
	}
}

func TestNativeAnthropicErrorsKeepSub2APIStatusAndBody(t *testing.T) {
	body := "{\"code\":\"INSUFFICIENT_BALANCE\",\"message\":\"Sub2API native failure\",\"request_id\":\"original\"}\n"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, body)
	}))
	defer upstream.Close()
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader("{\"model\":\"claude-opus-5\"}"))
	req.Header.Set("Authorization", "Bearer same-key")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	(&Server{Config: claudeTextTestConfig(upstream.URL)}).Router().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden || rr.Body.String() != body {
		t.Fatalf("native upstream error rewritten: %d %s", rr.Code, rr.Body.String())
	}
}

func TestNativeAndCodexDiscoveryBypassAggregation(t *testing.T) {
	for _, tc := range []struct{ path, header, value, body string }{
		{"/v1/models", "Anthropic-Version", "2023-06-01", "{\"data\":[{\"id\":\"claude-opus-5\",\"display_name\":\"Opaque\"}],\"has_more\":false,\"first_id\":\"claude-opus-5\"}\n"},
		{"/models", "X-Api-Key", "same-key", "{\"data\":[{\"id\":\"claude-opus-5\"}],\"unknown\":true}\n"},
		{"/v1/v1/models/claude-opus-5", "Anthropic-Beta", "future-2026", "{\"id\":\"claude-opus-5\",\"private_shape\":\"preserve\"}\n"},
		{"/v1/models?client_version=fixture", "", "", "{\"models\":[{\"slug\":\"claude-opus-5\",\"future_manifest\":true}]}\n"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, tc.body)
			}))
			defer upstream.Close()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req.Header.Set("Authorization", "Bearer same-key")
			if tc.header != "" {
				req.Header.Set(tc.header, tc.value)
			}
			rr := httptest.NewRecorder()
			(&Server{Config: claudeTextTestConfig(upstream.URL)}).Router().ServeHTTP(rr, req)
			if rr.Code != http.StatusOK || rr.Body.String() != tc.body || calls != 1 {
				t.Fatalf("discovery transformed or duplicated: %d calls=%d body=%s", rr.Code, calls, rr.Body.String())
			}
		})
	}
}

func TestNativeMessagesNeverEnterMediaEvenForRejectedModelNames(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/messages" {
			t.Errorf("native request routed to %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, "Sub2API model rejection")
	}))
	defer upstream.Close()
	cfg := claudeTextTestConfig(upstream.URL)
	cfg.MediaEnabled = true
	cfg.VerifiedMediaModels = map[string]struct{}{"MiniMax-H3": {}}
	cfg.MediaMultiplierByModel = map[string]float64{"MiniMax-H3": 1}
	cfg.ReservationQuotaByModel = map[string]int64{"MiniMax-H3": 100}
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader("{\"model\":\"MiniMax-H3\"}"))
	req.Header.Set("Authorization", "Bearer same-key")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	(&Server{Config: cfg}).Router().ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound || calls != 1 {
		t.Fatalf("model ownership interpreted in Relay: %d calls=%d", rr.Code, calls)
	}
}

func TestNativeOpaqueBodyAndTransportSizeLimit(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		b, _ := io.ReadAll(r.Body)
		if string(b) != "not-json" {
			t.Error("opaque invalid body changed")
		}
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, "upstream validates protocol")
	}))
	defer upstream.Close()
	for _, tc := range []struct {
		limit int64
		want  int
	}{{1024, 400}, {3, 413}} {
		cfg := claudeTextTestConfig(upstream.URL)
		cfg.MaxBodyBytes = tc.limit
		req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader("not-json"))
		req.Header.Set("Authorization", "Bearer same-key")
		req.Header.Set("Content-Type", "application/custom+json")
		rr := httptest.NewRecorder()
		(&Server{Config: cfg}).Router().ServeHTTP(rr, req)
		if rr.Code != tc.want {
			t.Errorf("limit=%d status=%d", tc.limit, rr.Code)
		}
	}
	if calls != 1 {
		t.Fatalf("oversized request was forwarded: calls=%d", calls)
	}
}

func TestNativeSSEFlushesUnknownEventsAndPropagatesCancellation(t *testing.T) {
	release := make(chan struct{})
	canceled := make(chan struct{}, 1)
	first := "event: future_event\ndata: {\"signature\":\"opaque\",\"cache\":8}\n\n"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, first)
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
			canceled <- struct{}{}
		case <-release:
		}
	}))
	defer upstream.Close()
	defer close(release)
	relay := httptest.NewServer((&Server{Config: claudeTextTestConfig(upstream.URL)}).Router())
	defer relay.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, relay.URL+"/v1/messages", strings.NewReader("{\"model\":\"claude-opus-5\",\"stream\":true}"))
	req.Header.Set("Authorization", "Bearer same-key")
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	got := make([]byte, len(first))
	if _, err := io.ReadFull(response.Body, got); err != nil || string(got) != first {
		t.Fatalf("SSE buffered or reconstructed: %v %s", err, got)
	}
	cancel()
	response.Body.Close()
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("client cancellation did not reach Sub2API")
	}
}
