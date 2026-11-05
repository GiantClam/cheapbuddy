package app

import (
	"bytes"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/store"
	"github.com/cheapbuddy/relay/internal/upstream"
)

func TestFixedImageReservationUsesRequestedCount(t *testing.T) {
	cfg := config.Config{ReservationQuotaByModel: map[string]int64{"gpt-image-2.5": 7692, "gpt-image-2.6": 7692}}
	for _, model := range []string{"gpt-image-2.5", "gpt-image-2.6"} {
		for _, n := range []int{1, 2, 4, 128} {
			amount, err := imageReservation(cfg, model, n)
			if err != nil || amount != 7692*int64(n) {
				t.Fatalf("model=%s n=%d hold=%d err=%v", model, n, amount, err)
			}
		}
	}
	for _, n := range []int{0, -1, 129} {
		if _, err := imageReservation(cfg, "gpt-image-2.6", n); err == nil {
			t.Fatalf("accepted invalid n=%d", n)
		}
	}
	cfg.ReservationQuotaByModel["gpt-image-2.6"] = math.MaxInt64
	if _, err := imageReservation(cfg, "gpt-image-2.6", 2); err == nil {
		t.Fatal("accepted overflowing reservation")
	}
}

func TestFixedImageJSONCountIsValidatedBeforeBilling(t *testing.T) {
	cfg := testConfig()
	cfg.MaxBodyBytes = 1 << 20
	server := &Server{Config: cfg}
	for _, suffix := range []string{"", `,"n":1`, `,"n":3`, `,"N":3`, `,"n":1,"N":3`, `,"N":1,"n":3`, `,"n":128`} {
		body := `{"model":"gpt-image-2.6","prompt":"test"` + suffix + `}`
		request := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		prepared, err := server.readRouteBody(request, request.URL.Path)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(prepared.body)
		_ = prepared.body.Close()
		want := 1
		if strings.Contains(suffix, ":3") {
			want = 3
		}
		if strings.Contains(suffix, ":128") {
			want = 128
		}
		if prepared.imageCount != want || string(got) != body {
			t.Fatalf("count=%d want=%d body preserved=%v", prepared.imageCount, want, string(got) == body)
		}
	}
	for _, n := range []string{"0", "-1", "129", "1.5", `"2"`, "null", "true"} {
		request := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(`{"model":"gpt-image-2.6","n":`+n+`}`))
		request.Header.Set("Authorization", "Bearer fixture-only")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		server.handleUserAPI(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("n=%s status=%d", n, response.Code)
		}
	}
}

func TestFixedImageMultipartCountsAfterFilesAndPreservesBody(t *testing.T) {
	for _, duplicate := range []bool{false, true} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("model", "gpt-image-2.5")
		file, _ := writer.CreateFormFile("image", "input.png")
		_, _ = file.Write([]byte("fixture-image"))
		_ = writer.WriteField("n", "4")
		if duplicate {
			_ = writer.WriteField("n", "2")
		}
		_ = writer.Close()
		request := httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewReader(body.Bytes()))
		request.Header.Set("Content-Type", writer.FormDataContentType())
		server := &Server{Config: config.Config{MaxBodyBytes: 1 << 20}}
		prepared, err := server.readRouteBody(request, request.URL.Path)
		if duplicate {
			if err == nil {
				_ = prepared.body.Close()
				t.Fatal("duplicate n accepted")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(prepared.body)
		_ = prepared.body.Close()
		if prepared.imageCount != 4 || !prepared.fullyBuffered || !bytes.Equal(got, body.Bytes()) {
			t.Fatalf("count=%d buffered=%v preserved=%v", prepared.imageCount, prepared.fullyBuffered, bytes.Equal(got, body.Bytes()))
		}
	}
}

func TestFixedImagePricingQuotesSameReservation(t *testing.T) {
	cfg := config.Config{QuotaPerUSD: 500000, ReservationQuotaByModel: map[string]int64{"gpt-image-2.6": 7692}}
	metadata, err := mediaPricingMetadata(cfg, "gpt-image-2.6", url.Values{"n": {"4"}})
	if err != nil {
		t.Fatal(err)
	}
	reservation := metadata["reservation"].(map[string]any)
	if reservation["estimated_quota"] != int64(30768) || reservation["estimated_amount_usd"] != 0.061536 {
		t.Fatalf("reservation=%v", reservation)
	}
	if _, err := mediaPricingMetadata(cfg, "gpt-image-2.6", url.Values{"n": {"1", "2"}}); err == nil {
		t.Fatal("duplicate pricing quantity accepted")
	}
}

func TestFixedImageCaptureNeverExceedsHold(t *testing.T) {
	for _, model := range []string{"gpt-image-2.5", "gpt-image-2.6", "other"} {
		for _, quota := range []int64{100, 7692, 15385} {
			amount, release := requestSettlementAmount(store.MediaRequest{Model: model, ReservationAmount: 7692}, upstream.Bill{FinalQuota: quota}, 1)
			want := quota
			if model != "other" && quota > 7692 {
				want = 7692
			}
			if release || amount != want {
				t.Fatalf("model=%s quota=%d amount=%d release=%v", model, quota, amount, release)
			}
		}
	}
	amount, release := requestSettlementAmount(store.MediaRequest{Model: "gpt-image-2.6", ReservationAmount: 7692}, upstream.Bill{}, 1)
	if !release || amount != 0 {
		t.Fatalf("zero usage amount=%d release=%v", amount, release)
	}
}

func TestMediaCallbackPreservesLargeImageResponse(t *testing.T) {
	body := `{"data":[{"b64_json":"` + strings.Repeat("A", 2<<20) + `"}]}`
	response := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}, "X-Oneapi-Request-Id": {"native"}}, Body: io.NopCloser(strings.NewReader(body))}
	if _, err := peekMediaJSONBody(response); err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || string(got) != body {
		t.Fatalf("response truncated: got=%d want=%d err=%v", len(got), len(body), err)
	}
}
