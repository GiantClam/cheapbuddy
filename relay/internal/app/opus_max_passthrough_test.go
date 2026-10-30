package app

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNativeAnthropicOpusMAXRequestKeepsPublicModelID(t *testing.T) {
	payload := `{"model":"claude-opus-5-5-MAX","max_tokens":1,"messages":[{"role":"user","content":"OK"}]}`
	responseBody := `{"id":"msg_test","type":"message","model":"claude-opus-5-5-MAX","content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn"}`
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if string(body) != payload || r.URL.Path != "/v1/messages" {
			t.Errorf("MAX request changed: path=%s body=%s", r.URL.Path, body)
		}
		if r.Header.Get("Authorization") != "Bearer shared-key" || r.Header.Get("Anthropic-Version") != "2023-06-01" {
			t.Error("native Anthropic authorization headers changed")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, responseBody)
	}))
	defer upstream.Close()

	cfg := claudeTextTestConfig(upstream.URL)
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(payload))
	req.Header.Set("X-Api-Key", "shared-key")
	req.Header.Set("Anthropic-Version", "2023-06-01")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	(&Server{Config: cfg}).Router().ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || rr.Body.String() != responseBody || calls != 1 {
		t.Fatalf("status=%d calls=%d body=%s", rr.Code, calls, rr.Body.String())
	}
}
