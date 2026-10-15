package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net/url"
	"strconv"
	"strings"

	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/upstream"
)

type h3SecondsKey struct{}

// The installed EcoPhase H3 plugin defaults to six seconds (durationOf), and
// charges tier("base", u("seconds") * 0.06). Use the same configured customer
// multiplier and ceiling as settlement; the legacy fixed hold is not its price.
func mediaReservation(cfg config.Config, model string, seconds int) (int64, error) {
	fixed, ok := cfg.ReservationQuotaByModel[model]
	if !ok {
		return 0, fmt.Errorf("Media reservation is not configured")
	}
	if mediaBillingMode(cfg, model) == "free" {
		return 0, nil
	}
	if model != "MiniMax-H3" {
		return fixed, nil
	}
	if seconds < 4 || seconds > 15 {
		return 0, fmt.Errorf("H3 duration must be an integer between 4 and 15 seconds")
	}
	multiplier := cfg.MediaMultiplierByModel[model]
	if cfg.QuotaPerUSD <= 0 || math.IsNaN(cfg.QuotaPerUSD) || math.IsInf(cfg.QuotaPerUSD, 0) || multiplier <= 0 || math.IsNaN(multiplier) || math.IsInf(multiplier, 0) {
		return 0, fmt.Errorf("H3 reservation pricing is unavailable")
	}
	nativeQuota := math.Ceil(float64(seconds) * 0.06 * cfg.QuotaPerUSD)
	if nativeQuota >= float64(math.MaxInt64) || nativeQuota*multiplier >= float64(math.MaxInt64) {
		return 0, fmt.Errorf("H3 reservation pricing is unavailable")
	}
	amount, _ := settlementAmount(upstream.Bill{FinalQuota: int64(nativeQuota)}, multiplier)
	return amount, nil
}

func h3SecondsFromContext(ctx context.Context) int {
	seconds, _ := ctx.Value(h3SecondsKey{}).(int)
	return seconds
}

func mediaPricingMetadata(cfg config.Config, model string, query url.Values) (map[string]any, error) {
	metadata := map[string]any{"billing_mode": mediaBillingMode(cfg, model), "media_multiplier": cfg.MediaMultiplierByModel[model], "quota_per_usd": cfg.QuotaPerUSD, "settlement": "The final debit follows actual successful usage; pending media duration is not estimated."}
	if model != "MiniMax-H3" {
		return metadata, nil
	}
	values := map[string]string{}
	for _, name := range []string{"seconds", "duration"} {
		if entries, ok := query[name]; ok {
			if len(entries) != 1 {
				return nil, fmt.Errorf("H3 duration must be provided once")
			}
			values[name] = entries[0]
		}
	}
	seconds, err := h3DurationValues(values)
	if err != nil {
		return nil, err
	}
	quota, err := mediaReservation(cfg, model, seconds)
	if err != nil {
		return nil, err
	}
	if cfg.QuotaPerUSD <= 0 || math.IsNaN(cfg.QuotaPerUSD) || math.IsInf(cfg.QuotaPerUSD, 0) {
		return nil, fmt.Errorf("H3 reservation pricing is unavailable")
	}
	metadata["reservation"] = map[string]any{"basis": "requested_seconds", "default_seconds": 6, "min_seconds": 4, "max_seconds": 15, "estimated_seconds": seconds, "estimated_quota": quota, "estimated_amount_usd": float64(quota) / cfg.QuotaPerUSD}
	return metadata, nil
}

func h3JSONSeconds(body []byte) (int, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal(body, &fields) != nil || fields == nil {
		return 0, fmt.Errorf("H3 request body must be an object")
	}
	// These names are ignored by the installed plugin when nested. Reject them
	// rather than hold for an ignored four-second value and submit its six default.
	if raw, ok := fields["parameters"]; ok {
		var nested map[string]json.RawMessage
		if json.Unmarshal(raw, &nested) == nil {
			for _, name := range []string{"seconds", "duration"} {
				if _, exists := nested[name]; exists {
					return 0, fmt.Errorf("H3 seconds and duration must be top-level fields")
				}
			}
		}
	}
	values := make(map[string]string, 2)
	for _, name := range []string{"seconds", "duration"} {
		if raw, ok := fields[name]; ok {
			var value any
			decoder := json.NewDecoder(strings.NewReader(string(raw)))
			decoder.UseNumber()
			if decoder.Decode(&value) != nil {
				return 0, fmt.Errorf("H3 duration is invalid")
			}
			switch typed := value.(type) {
			case json.Number:
				values[name] = string(typed)
			case string:
				values[name] = typed
			default:
				return 0, fmt.Errorf("H3 duration must be an integer between 4 and 15 seconds")
			}
		}
	}
	return h3DurationValues(values)
}

func h3DurationValues(values map[string]string) (int, error) {
	seconds := 0
	for _, name := range []string{"seconds", "duration"} {
		value, ok := values[name]
		if !ok {
			continue
		}
		number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number < 4 || number > 15 {
			return 0, fmt.Errorf("H3 duration must be an integer between 4 and 15 seconds")
		}
		if seconds != 0 && seconds != int(number) {
			return 0, fmt.Errorf("H3 seconds and duration must agree")
		}
		seconds = int(number)
	}
	if seconds == 0 {
		seconds = 6
	}
	return seconds, nil
}

func h3MultipartSeconds(source io.Reader, contentType string) (int, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil || params["boundary"] == "" {
		return 0, fmt.Errorf("multipart boundary is invalid")
	}
	reader := multipart.NewReader(source, params["boundary"])
	values := map[string]string{}
	seenModel := false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return 0, fmt.Errorf("multipart body is invalid")
		}
		name := part.FormName()
		if part.FileName() != "" {
			if name == "seconds" || name == "duration" || name == "model" {
				return 0, fmt.Errorf("H3 duration and model must be text fields")
			}
			if _, err := io.Copy(io.Discard, part); err != nil {
				return 0, fmt.Errorf("multipart body is invalid")
			}
			continue
		}
		if name == "model" {
			if seenModel {
				return 0, fmt.Errorf("H3 model must be provided once")
			}
			seenModel = true
		}
		if name == "parameters" {
			data, err := io.ReadAll(io.LimitReader(part, 65537))
			if err != nil || len(data) > 65536 {
				return 0, fmt.Errorf("H3 parameters field is too large")
			}
			wrapped := append([]byte(`{"parameters":`), data...)
			wrapped = append(wrapped, '}')
			if json.Valid(wrapped) {
				if _, err := h3JSONSeconds(wrapped); err != nil {
					return 0, err
				}
			}
			continue
		}
		if name != "seconds" && name != "duration" {
			if _, err := io.Copy(io.Discard, part); err != nil {
				return 0, fmt.Errorf("multipart body is invalid")
			}
			continue
		}
		if _, exists := values[name]; exists {
			return 0, fmt.Errorf("H3 duration must be provided once")
		}
		data, err := io.ReadAll(io.LimitReader(part, 65))
		if err != nil || len(data) > 64 {
			return 0, fmt.Errorf("H3 duration is invalid")
		}
		values[name] = string(data)
	}
	return h3DurationValues(values)
}
