package upstream

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"unicode/utf8"
)

func TestFindBillUsesNewAPIRequestIDCorrelation(t *testing.T) {
	payload := map[string]any{"data": map[string]any{"items": []any{map[string]any{"id": 9.0, "request_id": "newapi-request-1", "quota": 123.0}}}}
	bill, found, err := findBill(payload, "newapi-request-1")
	if err != nil || !found || bill.ID != "9" || bill.FinalQuota != 123 {
		t.Fatalf("unexpected bill: %+v found=%v err=%v", bill, found, err)
	}
}

func TestFindBillDoesNotUseTaskOrOtherLooseCorrelation(t *testing.T) {
	payload := map[string]any{"data": map[string]any{"items": []any{map[string]any{
		"id": 9.0, "request_id": "other-request", "task_id": "newapi-request-1", "quota": 123.0,
	}}}}
	if _, found, err := findBill(payload, "newapi-request-1"); err != nil || found {
		t.Fatalf("expected no bill from a non-request_id match, found=%v err=%v", found, err)
	}
}

func TestFindBillQueriesNewAPILogByRequestID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/log/" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if got := request.URL.Query().Get("request_id"); got != "newapi-request-1" {
			t.Fatalf("request_id = %q", got)
		}
		if got := request.URL.Query().Get("keyword"); got != "" {
			t.Fatalf("deprecated keyword query was sent: %q", got)
		}
		if request.Header.Get("Authorization") != "Bearer admin-token" {
			t.Fatal("missing admin authorization")
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"data":{"items":[{"id":9,"request_id":"newapi-request-1","quota":123}]}}`))
	}))
	t.Cleanup(server.Close)

	bill, found, err := New(0).FindBill(context.Background(), server.URL, "admin-token", "/api/log/", "newapi-request-1", "relay-request-1")
	if err != nil || !found || bill.ID != "9" || bill.FinalQuota != 123 {
		t.Fatalf("unexpected bill: %+v found=%v err=%v", bill, found, err)
	}
}

func TestFindUserIDFindsExistingShadowUser(t *testing.T) {
	payload := map[string]any{"data": map[string]any{"items": []any{
		map[string]any{"id": 8.0, "username": "other"},
		map[string]any{"id": 9.0, "username": "cheapbuddy_42"},
	}}}
	if id := findUserID(payload, "cheapbuddy_42"); id != 9 {
		t.Fatalf("expected existing shadow user id 9, got %d", id)
	}
}

func TestRandomSecretFitsNewAPIUserPasswordLimit(t *testing.T) {
	for range 32 {
		secret, err := randomSecret()
		if err != nil {
			t.Fatalf("generate secret: %v", err)
		}
		if length := utf8.RuneCountInString(secret); length < 8 || length > 20 {
			t.Fatalf("secret length %d is outside NewAPI's password range", length)
		}
	}
}

func TestRawPostJSONRejectsNewAPIBusinessError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":false,"message":"user input is invalid"}`))
	}))
	t.Cleanup(server.Close)

	_, err := New(0).rawPostJSON(context.Background(), server.URL, "", map[string]string{}, "request-1")
	if err == nil {
		t.Fatal("expected business failure response to be rejected")
	}
}

func TestSetShadowUserQuotaUsesNativeNewAPIManageEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/user/manage" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer admin-token" {
			t.Fatal("missing admin authorization")
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["action"] != "add_quota" || payload["mode"] != "override" {
			t.Fatalf("unexpected quota action: %#v", payload)
		}
		if got, ok := numeric(payload["value"]); !ok || got != newAPIShadowUserQuota {
			t.Fatalf("quota = %v", payload["value"])
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"message":""}`))
	}))
	t.Cleanup(server.Close)

	if err := New(0).setShadowUserQuota(context.Background(), server.URL, "admin-token", 8, "request-1"); err != nil {
		t.Fatalf("set shadow quota: %v", err)
	}
}
