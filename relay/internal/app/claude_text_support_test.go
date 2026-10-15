package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cheapbuddy/relay/internal/config"
)

var claudeTestModels = []string{"claude-fable-5", "claude-fable-5-1", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5"}

func claudeTextTestConfig(upstreamURL string) config.Config {
	return config.Config{Sub2APIURL: upstreamURL, Sub2APITimeout: 2 * time.Second, MaxBodyBytes: 1 << 20, TextPaths: map[string]struct{}{"/v1/messages": {}, "/v1/messages/count_tokens": {}, "/v1/chat/completions": {}, "/v1/responses": {}}}
}

func TestClaudeModelsStayOnSub2APITextRoutes(t *testing.T) {
	cfg := claudeTextTestConfig("")
	cfg.MediaEnabled = true
	cfg.VerifiedMediaModels = map[string]struct{}{"MiniMax-H3": {}}
	for _, model := range claudeTestModels {
		for _, route := range []string{"/v1/messages", "/v1/messages/count_tokens", "/v1/chat/completions", "/v1/responses"} {
			if got := classifyRoute(route, model, cfg); got != routeText {
				t.Errorf("%s %s route=%v", model, route, got)
			}
		}
	}
}

func TestClaudeNativeXAPIKeyRoutes(t *testing.T) {
	for _, route := range []string{"/v1/messages", "/v1/messages/count_tokens", "/v1/models", "/v1/models/claude-sonnet-5-5"} {
		t.Run(route, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Authorization") != "Bearer claude-test-key" {
					t.Errorf("upstream credential was not normalized")
				}
				if r.Header.Get("X-Api-Key") != "" {
					t.Errorf("client x-api-key leaked through proxy")
				}
				if r.URL.Path != route && r.URL.Path != "/v1/models" {
					t.Errorf("unexpected upstream path %s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/v1/models" {
					fmt.Fprint(w, `{"object":"list","data":[{"id":"claude-sonnet-5-5","object":"model"}]}`)
				} else {
					fmt.Fprint(w, `{"id":"claude-sonnet-5-5","object":"model","ok":true}`)
				}
			}))
			defer upstream.Close()
			s := &Server{Config: claudeTextTestConfig(upstream.URL)}
			method := http.MethodPost
			if strings.Contains(route, "/models") {
				method = http.MethodGet
			}
			req := httptest.NewRequest(method, route, strings.NewReader(`{"model":"claude-sonnet-5-5","messages":[{"role":"user","content":"Hi"}]}`))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Api-Key", "claude-test-key")
			req.Header.Set("Anthropic-Version", "2023-06-01")
			response := httptest.NewRecorder()
			s.Router().ServeHTTP(response, req)
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if calls == 0 {
				t.Fatal("native request never reached Sub2API")
			}
			if route == "/v1/models" {
				var payload struct {
					Data []map[string]any `json:"data"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				if len(payload.Data) != 1 || payload.Data[0]["id"] != "claude-sonnet-5-5" {
					t.Fatal("catalog must stay scoped to the upstream key")
				}
			}
		})
	}
}

func TestClaudeBearerCredentialTakesPrecedence(t *testing.T) {
	for _, tc := range []struct {
		authorization string
		wantStatus    int
		wantCalls     int
	}{
		{"Bearer chosen-key", http.StatusOK, 1},
		{"Basic invalid", http.StatusUnauthorized, 0},
	} {
		t.Run(tc.authorization, func(t *testing.T) {
			calls := 0
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Authorization") != "Bearer chosen-key" || r.Header.Get("X-Api-Key") != "" {
					t.Error("conflicting client credential forwarded")
				}
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, `{"ok":true}`)
			}))
			defer upstream.Close()
			s := &Server{Config: claudeTextTestConfig(upstream.URL)}
			req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"claude-opus-5-5"}`))
			req.Header.Set("Authorization", tc.authorization)
			req.Header.Set("X-Api-Key", "ignored-key")
			rr := httptest.NewRecorder()
			s.Router().ServeHTTP(rr, req)
			if rr.Code != tc.wantStatus || calls != tc.wantCalls {
				t.Fatalf("status=%d calls=%d", rr.Code, calls)
			}
		})
	}
}

func TestClaudeNativeCredentialsDoNotOpenMediaOrPrivateRoutes(t *testing.T) {
	cfg := claudeTextTestConfig("http://127.0.0.1:1")
	cfg.MediaEnabled = true
	cfg.MediaPaths = map[string]struct{}{"/v1/images/generations": {}}
	for _, tc := range []struct {
		path   string
		status int
	}{{"/v1/images/generations", 401}, {"/api/v1/admin/accounts", 404}, {"/v1/messages/other", 404}} {
		req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(`{"model":"claude-opus-5-5"}`))
		req.Header.Set("X-Api-Key", "claude-test-key")
		rr := httptest.NewRecorder()
		(&Server{Config: cfg}).Router().ServeHTTP(rr, req)
		if rr.Code != tc.status {
			t.Errorf("%s status=%d", tc.path, rr.Code)
		}
	}
}

func TestClaudeNativeInferenceRoutesRequirePOST(t *testing.T) {
	for _, route := range []string{"/v1/messages", "/v1/messages/count_tokens"} {
		req := httptest.NewRequest(http.MethodGet, route, nil)
		req.Header.Set("X-Api-Key", "claude-test-key")
		req.Header.Set("Anthropic-Version", "2023-06-01")
		rr := httptest.NewRecorder()
		(&Server{Config: claudeTextTestConfig("http://127.0.0.1:1")}).Router().ServeHTTP(rr, req)
		if rr.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s status=%d", route, rr.Code)
		}
	}
}

func TestClaudeCORSAllowsNativeHeaders(t *testing.T) {
	s := &Server{Config: config.Config{AllowedCORSOrigins: map[string]struct{}{"https://cheapbuddy.cc": {}}}}
	req := httptest.NewRequest(http.MethodOptions, "/v1/messages", nil)
	req.Header.Set("Origin", "https://cheapbuddy.cc")
	rr := httptest.NewRecorder()
	s.Router().ServeHTTP(rr, req)
	for _, header := range []string{"x-api-key", "anthropic-version", "anthropic-beta"} {
		if !strings.Contains(strings.ToLower(rr.Header().Get("Access-Control-Allow-Headers")), header) {
			t.Errorf("missing CORS header %s", header)
		}
	}
}
