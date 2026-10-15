package upstream

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestH3TaskRequiresExactOwnedCorrelation(t *testing.T) {
	for _, tc := range []struct {
		name, body     string
		found, wantErr bool
	}{
		{"success", `{"success":true,"data":{"items":[{"task_id":"task1","user_id":4,"status":"SUCCESS","admin_info":{"request_id":"native1"}}]}}`, true, false},
		{"failed", `{"success":true,"data":{"items":[{"task_id":"task1","user_id":4,"status":"FAILURE","admin_info":{"request_id":"native1"}}]}}`, true, false},
		{"other owner", `{"success":true,"data":{"items":[{"task_id":"task1","user_id":5,"status":"SUCCESS","admin_info":{"request_id":"native1"}}]}}`, false, false},
		{"other correlation", `{"success":true,"data":{"items":[{"task_id":"task1","user_id":4,"status":"SUCCESS","admin_info":{"request_id":"other"}}]}}`, false, false},
		{"other task", `{"success":true,"data":{"items":[{"task_id":"other","user_id":4,"status":"SUCCESS","admin_info":{"request_id":"native1"}}]}}`, false, false},
		{"business error", `{"success":false,"message":"unavailable"}`, false, true},
		{"duplicate", `{"success":true,"data":{"items":[{"task_id":"task1","user_id":4,"status":"SUCCESS","admin_info":{"request_id":"native1"}},{"task_id":"task1","user_id":4,"status":"SUCCESS","admin_info":{"request_id":"native1"}}]}}`, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/task" || r.URL.Query().Get("task_id") != "task1" || r.Header.Get("Authorization") != "Bearer admin" {
					t.Error("wrong task request")
				}
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			_, found, err := New(0).FindH3TaskStatus(context.Background(), srv.URL, "admin", "task1", 4, "native1", "relay1")
			if found != tc.found || (err != nil) != tc.wantErr {
				t.Fatalf("found=%v err=%v", found, err)
			}
		})
	}
}

func TestH3BillRequiresUniqueOwnedConsumption(t *testing.T) {
	for _, tc := range []struct {
		name, body     string
		found, wantErr bool
	}{
		{"valid", `{"success":true,"data":{"items":[{"id":124,"request_id":"native1","user_id":4,"type":2,"quota":120000}]}}`, true, false},
		{"wrong owner", `{"success":true,"data":{"items":[{"id":124,"request_id":"native1","user_id":5,"type":2,"quota":120000}]}}`, false, false},
		{"error log", `{"success":true,"data":{"items":[{"id":124,"request_id":"native1","user_id":4,"type":5,"quota":0}]}}`, false, false},
		{"wrong request", `{"success":true,"data":{"items":[{"id":124,"request_id":"other","user_id":4,"type":2,"quota":120000}]}}`, false, false},
		{"business failure", `{"success":false,"data":{"items":[{"id":124,"request_id":"native1","user_id":4,"type":2,"quota":120000}]}}`, false, true},
		{"ambiguous", `{"data":{"items":[{"id":124,"request_id":"native1","user_id":4,"type":2,"quota":120000},{"id":125,"request_id":"native1","user_id":4,"type":2,"quota":120000}]}}`, false, true},
		{"negative", `{"data":{"items":[{"id":124,"request_id":"native1","user_id":4,"type":2,"quota":-1}]}}`, false, true},
		{"missing identity", `{"data":{"items":[{"request_id":"native1","user_id":4,"type":2,"quota":120000}]}}`, false, true},
		{"invalid items", `{"data":{}}`, false, true},
		{"invalid envelope", `{}`, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(tc.body)) }))
			defer srv.Close()
			_, found, err := New(0).FindH3Bill(context.Background(), srv.URL, "admin", "/api/log/", "native1", "relay1", 4)
			if found != tc.found || (err != nil) != tc.wantErr {
				t.Fatalf("found=%v err=%v", found, err)
			}
		})
	}
}
