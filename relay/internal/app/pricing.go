package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

var errPricingModelNotFound = errors.New("pricing model not found")

func fetchModelPricing(parent context.Context, transport http.RoundTripper, timeout time.Duration, baseURL, model, token, requestID string) (map[string]any, map[string]any, error) {
	if transport == nil {
		return nil, nil, errors.New("pricing transport unavailable")
	}
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/api/pricing", nil)
	if err != nil {
		return nil, nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-Request-ID", requestID)
	response, err := transport.RoundTrip(request)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, nil, errors.New("upstream pricing request failed")
	}
	var payload map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, nil, err
	}
	pricing, ok := selectModelPricing(payload, model)
	if !ok {
		return nil, nil, errPricingModelNotFound
	}
	groupRatio := map[string]any{}
	if allRatios, ok := payload["group_ratio"].(map[string]any); ok {
		if defaultRatio, found := allRatios["default"]; found {
			groupRatio["default"] = defaultRatio
		}
	}
	return pricing, groupRatio, nil
}
