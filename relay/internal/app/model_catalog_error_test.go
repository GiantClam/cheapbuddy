package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cheapbuddy/relay/internal/config"
)

func TestCustomerModelCatalogPreservesAuthPermissionAndRateStatuses(t *testing.T) {
	for _, test := range []struct {
		status int
		kind   string
	}{
		{http.StatusUnauthorized, "authentication_error"},
		{http.StatusForbidden, "permission_error"},
		{http.StatusTooManyRequests, "rate_limit_error"},
	} {
		t.Run(test.kind, func(t *testing.T) {
			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				_, _ = io.WriteString(w, `{"error":{"message":"private-key and private-upstream-url"}}`)
			}))
			defer backend.Close()
			server := &Server{Config: config.Config{Sub2APIURL: backend.URL, Sub2APITimeout: time.Second}}
			response := httptest.NewRecorder()
			server.handleModels(response, httptest.NewRequest(http.MethodGet, "/v1/models", nil), "customer-key", "catalog-check")
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.kind) {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "private-") {
				t.Fatal("upstream error body escaped the public boundary")
			}
			if test.status == http.StatusTooManyRequests && response.Header().Get("Retry-After") == "" {
				t.Fatal("rate-limited catalog omitted Retry-After")
			}
		})
	}
}

func TestShadowCatalogAuthFailureIsNotCustomerAuthFailure(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer backend.Close()
	server := &Server{Config: config.Config{Sub2APIURL: "http://sub2api.invalid", NewAPIURL: backend.URL, Sub2APITimeout: time.Second}}
	_, status, err := server.fetchModelsPayload(httptest.NewRequest(http.MethodGet, "/v1/models", nil), backend.URL, "shadow-token", "catalog-check")
	if err == nil || status != http.StatusBadGateway {
		t.Fatalf("shadow catalog status = %d, err = %v", status, err)
	}
}

func TestCustomerCatalogUpstreamFailureRemainsBadGateway(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer backend.Close()
	server := &Server{Config: config.Config{Sub2APIURL: backend.URL, Sub2APITimeout: time.Second}}
	response := httptest.NewRecorder()
	server.handleModels(response, httptest.NewRequest(http.MethodGet, "/v1/models", nil), "customer-key", "catalog-check")
	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.Code)
	}
}
