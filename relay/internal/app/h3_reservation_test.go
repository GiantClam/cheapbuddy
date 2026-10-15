package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/upstream"
)

func h3ReservationConfig() config.Config {
	return config.Config{MaxBodyBytes: 1 << 20, QuotaPerUSD: 500000, ReservationQuotaByModel: map[string]int64{"MiniMax-H3": 1000000, "other": 900}, MediaMultiplierByModel: map[string]float64{"MiniMax-H3": 0.2566666666}}
}

func TestH3PreparedJSONReservation(t *testing.T) {
	for _, tc := range []struct {
		body    string
		seconds int
		quota   int64
	}{
		{`{"model":"MiniMax-H3","seconds":4}`, 4, 30800},
		{`{"model":"MiniMax-H3","duration":"15"}`, 15, 115500},
		{`{"model":"MiniMax-H3"}`, 6, 46200},
		{`{"model":"MiniMax-H3","seconds":8,"duration":8}`, 8, 61600},
	} {
		t.Run(tc.body, func(t *testing.T) {
			server := &Server{Config: h3ReservationConfig()}
			request := httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewBufferString(tc.body))
			request.Header.Set("Content-Type", "application/json")
			prepared, err := server.readRouteBody(request, request.URL.Path)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.body.Close()
			if prepared.h3Seconds != tc.seconds {
				t.Fatalf("seconds=%d want%d", prepared.h3Seconds, tc.seconds)
			}
			amount, err := mediaReservation(server.Config, prepared.model, prepared.h3Seconds)
			if err != nil || amount != tc.quota {
				t.Fatalf("amount=%d err=%v want%d", amount, err, tc.quota)
			}
			replayed, _ := io.ReadAll(prepared.body)
			if string(replayed) != tc.body {
				t.Fatal("body changed")
			}
			settled, _ := settlementAmount(upstream.Bill{FinalQuota: int64(tc.seconds * 30000)}, server.Config.MediaMultiplierByModel["MiniMax-H3"])
			if settled != amount {
				t.Fatalf("hold%d differs settlement%d", amount, settled)
			}
		})
	}
}

func TestH3PreparedJSONRejectsInvalidDuration(t *testing.T) {
	for _, fields := range []string{`"seconds":-1`, `"seconds":3`, `"seconds":16`, `"seconds":4.5`, `"seconds":"four"`, `"seconds":null`, `"seconds":true`, `"seconds":""`, `"seconds":4,"duration":6`, `"parameters":{"seconds":4}`, `"parameters":{"duration":4}`} {
		request := httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewBufferString(`{"model":"MiniMax-H3",`+fields+`}`))
		request.Header.Set("Content-Type", "application/json")
		if prepared, err := (&Server{Config: h3ReservationConfig()}).readRouteBody(request, request.URL.Path); err == nil {
			prepared.body.Close()
			t.Errorf("accepted %s", fields)
		}
	}
}

func TestH3MultipartDurationAfterFilePreservesBody(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("model", "MiniMax-H3")
	file, _ := writer.CreateFormFile("reference_video", "clip.mp4")
	_, _ = file.Write([]byte("video bytes"))
	_ = writer.WriteField("seconds", "4")
	_ = writer.Close()
	for _, idempotent := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(body.Bytes()))
		request.Header.Set("Content-Type", writer.FormDataContentType())
		if idempotent {
			request.Header.Set("Idempotency-Key", "retry")
		}
		prepared, err := (&Server{Config: h3ReservationConfig()}).readRouteBody(request, request.URL.Path)
		if err != nil {
			t.Fatal(err)
		}
		if prepared.h3Seconds != 4 || !prepared.fullyBuffered {
			t.Fatalf("duration=%d buffered=%v", prepared.h3Seconds, prepared.fullyBuffered)
		}
		replayed, _ := io.ReadAll(prepared.body)
		_ = prepared.body.Close()
		if !bytes.Equal(body.Bytes(), replayed) {
			t.Fatal("file/body changed")
		}
	}
}

func TestH3MultipartRejectsDuplicateOrInvalidDuration(t *testing.T) {
	for _, values := range [][]string{{"4", "8"}, {"-1"}, {"4.5"}, {""}} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("model", "MiniMax-H3")
		for _, value := range values {
			_ = writer.WriteField("seconds", value)
		}
		_ = writer.Close()
		request := httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(body.Bytes()))
		request.Header.Set("Content-Type", writer.FormDataContentType())
		if prepared, err := (&Server{Config: h3ReservationConfig()}).readRouteBody(request, request.URL.Path); err == nil {
			prepared.body.Close()
			t.Fatalf("accepted %v", values)
		}
	}
}

func TestMediaReservationPreservesNonH3AndFreeMode(t *testing.T) {
	cfg := h3ReservationConfig()
	if amount, err := mediaReservation(cfg, "other", 0); err != nil || amount != 900 {
		t.Fatalf("other=%d %v", amount, err)
	}
	cfg.MediaBillingModeByModel = map[string]string{"MiniMax-H3": "free"}
	if amount, err := mediaReservation(cfg, "MiniMax-H3", 4); err != nil || amount != 0 {
		t.Fatalf("free=%d %v", amount, err)
	}
	if _, err := mediaReservation(cfg, "unknown", 4); err == nil {
		t.Fatal("unconfigured accepted")
	}
	cfg.MediaBillingModeByModel = nil
	for _, seconds := range []int{0, 3, 16} {
		if _, err := mediaReservation(cfg, "MiniMax-H3", seconds); err == nil {
			t.Fatal("invalid prepared duration accepted")
		}
	}
}

func TestH3PricingEstimate(t *testing.T) {
	for _, tc := range []struct {
		query   string
		seconds int
		quota   int64
	}{{"", 6, 46200}, {"seconds=4", 4, 30800}, {"duration=15", 15, 115500}} {
		values, _ := url.ParseQuery(tc.query)
		metadata, err := mediaPricingMetadata(h3ReservationConfig(), "MiniMax-H3", values)
		if err != nil {
			t.Fatal(err)
		}
		estimate := metadata["reservation"].(map[string]any)
		if estimate["estimated_seconds"] != tc.seconds || estimate["estimated_quota"] != tc.quota || estimate["estimated_amount_usd"] != float64(tc.quota)/500000 {
			t.Fatalf("estimate=%v", estimate)
		}
	}
	for _, query := range []string{"seconds=3", "seconds=-1", "seconds=4.5", "seconds=4&duration=6", "seconds=4&seconds=8"} {
		values, _ := url.ParseQuery(query)
		if _, err := mediaPricingMetadata(h3ReservationConfig(), "MiniMax-H3", values); err == nil {
			t.Errorf("accepted %s", query)
		}
		response := httptest.NewRecorder()
		(&Server{Config: testConfig()}).handlePricing(response, httptest.NewRequest(http.MethodGet, "/v1/pricing?model=MiniMax-H3&"+query, nil), "unused", "test")
		if response.Code != 400 {
			t.Fatalf("invalid query HTTP%d", response.Code)
		}
	}
	metadata, err := mediaPricingMetadata(h3ReservationConfig(), "other", url.Values{"seconds": {"garbage"}})
	if err != nil || metadata["reservation"] != nil {
		t.Fatal("nonH3 pricing changed")
	}
}

func TestH3PreparedReservationReachesBillingRPC(t *testing.T) {
	type capturedBilling struct {
		amount    int64
		operation string
	}
	captured := make(chan capturedBilling, 4)
	billing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Amount int64 `json:"amount"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		captured <- capturedBilling{amount: payload.Amount, operation: r.URL.Path}
		if payload.Amount > 30800 {
			w.WriteHeader(http.StatusPaymentRequired)
			_, _ = io.WriteString(w, `{"error":"insufficient balance"}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{}}`)
	}))
	defer billing.Close()
	cfg := h3ReservationConfig()
	cfg.Sub2APIURL = billing.URL
	cfg.Sub2APITimeout = time.Second
	server := &Server{Config: cfg, Upstream: upstream.New(0)}
	for _, pathName := range []string{"/v1/videos", "/v1/responses"} {
		request := httptest.NewRequest(http.MethodPost, pathName, bytes.NewBufferString(`{"model":"MiniMax-H3","seconds":4}`))
		request.Header.Set("Content-Type", "application/json")
		cfg.TextPaths = map[string]struct{}{"/v1/responses": {}}
		server.Config = cfg
		prepared, err := server.readRouteBody(request, request.URL.Path)
		if err != nil {
			t.Fatal(err)
		}
		defer prepared.body.Close()
		ctx := context.WithValue(context.Background(), h3SecondsKey{}, prepared.h3Seconds)
		amount, err := mediaReservation(cfg, prepared.model, h3SecondsFromContext(ctx))
		if err != nil {
			t.Fatal(err)
		}
		if err := server.reserve(ctx, upstream.Identity{UserID: 1, APIKeyID: 1}, "test", amount); err != nil {
			t.Fatal(err)
		}
		reserved := <-captured
		if reserved.amount != 30800 || !strings.HasSuffix(reserved.operation, "/reserve") {
			t.Fatalf("billing RPC amount=%d operation=%s", reserved.amount, reserved.operation)
		}
		if err := server.release(ctx, upstream.Identity{UserID: 1, APIKeyID: 1}, "test", amount); err != nil {
			t.Fatal(err)
		}
		released := <-captured
		if released.amount != 30800 || !strings.HasSuffix(released.operation, "/release") {
			t.Fatalf("release differs amount=%d operation=%s", released.amount, released.operation)
		}
	}
}

func TestH3InvalidRequestStopsBeforeIdentityOrBilling(t *testing.T) {
	for _, pathName := range []string{"/v1/videos", "/v1/responses"} {
		request := httptest.NewRequest(http.MethodPost, pathName, bytes.NewBufferString(`{"model":"MiniMax-H3","seconds":4,"duration":8}`))
		request.Header.Set("Authorization", "Bearer fixture-only")
		request.Header.Set("Content-Type", "application/json")
		cfg := testConfig()
		cfg.MaxBodyBytes = 1 << 20
		response := httptest.NewRecorder()
		// Nil identity/cache/billing clients ensure validation cannot accidentally
		// reach these dependencies or reserve any funds on an invalid request.
		(&Server{Config: cfg}).handleUserAPI(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s status=%d", pathName, response.Code)
		}
	}
}

func TestH3ReservationMatchesEverySupportedDuration(t *testing.T) {
	cfg := h3ReservationConfig()
	for seconds := 4; seconds <= 15; seconds++ {
		amount, err := mediaReservation(cfg, "MiniMax-H3", seconds)
		settled, _ := settlementAmount(upstream.Bill{FinalQuota: int64(seconds * 30000)}, cfg.MediaMultiplierByModel["MiniMax-H3"])
		if err != nil || amount != settled || amount != int64(seconds*7700) {
			t.Fatalf("seconds=%d hold=%d settled=%d err=%v", seconds, amount, settled, err)
		}
	}
	for _, invalid := range []float64{0, -1, math.NaN(), math.Inf(1), math.MaxFloat64} {
		cfg.QuotaPerUSD = invalid
		if _, err := mediaReservation(cfg, "MiniMax-H3", 4); err == nil {
			t.Errorf("accepted invalid quota %v", invalid)
		}
	}
	cfg = h3ReservationConfig()
	cfg.QuotaPerUSD = 3
	amount, err := mediaReservation(cfg, "MiniMax-H3", 6)
	if err != nil || amount != 1 {
		t.Fatalf("native ceil then customer ceil hold=%d %v", amount, err)
	}
}

func TestH3MultipartRejectsMalformedBoundaryAndFileDuration(t *testing.T) {
	if _, err := h3MultipartSeconds(strings.NewReader(""), "multipart/form-data"); err == nil {
		t.Fatal("missing boundary accepted")
	}
	if _, err := h3MultipartSeconds(strings.NewReader("broken"), "multipart/form-data; boundary=x"); err == nil {
		t.Fatal("broken body accepted")
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, _ := writer.CreateFormFile("seconds", "duration.txt")
	_, _ = file.Write([]byte("4"))
	_ = writer.Close()
	if _, err := h3MultipartSeconds(bytes.NewReader(body.Bytes()), writer.FormDataContentType()); err == nil {
		t.Fatal("file duration accepted")
	}
}

func TestH3MultipartRejectsIgnoredNestedDurationAndDuplicateModel(t *testing.T) {
	for _, name := range []string{"parameters", "model"} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("model", "MiniMax-H3")
		value := `{"seconds":4}`
		if name == "model" {
			value = "MiniMax-H3"
		}
		_ = writer.WriteField(name, value)
		_ = writer.Close()
		if _, err := h3MultipartSeconds(bytes.NewReader(body.Bytes()), writer.FormDataContentType()); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
}

func TestH3FreePricingAndInvalidRate(t *testing.T) {
	cfg := h3ReservationConfig()
	cfg.MediaBillingModeByModel = map[string]string{"MiniMax-H3": "free"}
	metadata, err := mediaPricingMetadata(cfg, "MiniMax-H3", nil)
	if err != nil || metadata["reservation"].(map[string]any)["estimated_quota"] != int64(0) {
		t.Fatalf("free metadata=%v err=%v", metadata, err)
	}
	cfg.MediaBillingModeByModel = nil
	for _, invalid := range []float64{0, -1, math.NaN(), math.Inf(1), math.MaxFloat64} {
		cfg.MediaMultiplierByModel["MiniMax-H3"] = invalid
		if _, err := mediaPricingMetadata(cfg, "MiniMax-H3", nil); err == nil {
			t.Errorf("accepted invalid multiplier %v", invalid)
		}
	}
}
