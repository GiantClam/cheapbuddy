package upstream

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	HTTP *http.Client
}

type Identity struct {
	UserID   int64 `json:"user_id"`
	APIKeyID int64 `json:"api_key_id"`
}

type ShadowIdentity struct {
	NewAPIUserID int64
	MediaToken   string
}

type Bill struct {
	ID         string
	FinalQuota int64
	Status     string
}

const newAPIShadowUserQuota = int64(1<<53 - 1)

func New(timeout time.Duration) *Client {
	return &Client{HTTP: &http.Client{Timeout: timeout}}
}

func (c *Client) ResolveIdentity(ctx context.Context, baseURL, serviceToken, apiKey, requestID string) (Identity, error) {
	var payload struct {
		UserID   int64 `json:"user_id"`
		APIKeyID int64 `json:"api_key_id"`
	}
	if err := c.postJSON(ctx, baseURL+"/api/internal/cheapbuddy/identity", serviceToken, map[string]string{"api_key": apiKey}, requestID, &payload); err != nil {
		return Identity{}, err
	}
	if payload.UserID <= 0 || payload.APIKeyID <= 0 {
		return Identity{}, fmt.Errorf("invalid identity response")
	}
	return Identity{UserID: payload.UserID, APIKeyID: payload.APIKeyID}, nil
}

func (c *Client) Billing(ctx context.Context, baseURL, serviceToken, operation, requestID string, payload any) (map[string]any, error) {
	var response map[string]any
	err := c.postJSON(ctx, baseURL+"/api/internal/cheapbuddy/billing/"+url.PathEscape(operation), serviceToken, payload, requestID, &response)
	return response, err
}

func (c *Client) ProvisionShadowIdentity(ctx context.Context, baseURL, adminToken, userPath, loginPath string, userID int64, verifiedModels []string, requestID string) (ShadowIdentity, error) {
	username := fmt.Sprintf("cheapbuddy_%d", userID)
	password, err := randomSecret()
	if err != nil {
		return ShadowIdentity{}, err
	}
	createPayload := map[string]any{"username": username, "password": password, "display_name": username, "role": 1, "quota": 0}
	created, err := c.rawPostJSON(ctx, baseURL+userPath, adminToken, createPayload, requestID)
	newAPIUserID := int64(0)
	if err == nil {
		newAPIUserID = nestedInt(dataOf(created), "id")
	}
	if newAPIUserID <= 0 {
		searched, searchErr := c.rawGetJSON(ctx, baseURL+"/api/user/search?keyword="+url.QueryEscape(username)+"&p=1&page_size=10", adminToken, requestID)
		if searchErr != nil {
			if err != nil {
				return ShadowIdentity{}, fmt.Errorf("create NewAPI shadow user: %w", err)
			}
			return ShadowIdentity{}, fmt.Errorf("search NewAPI shadow user: %w", searchErr)
		}
		newAPIUserID = findUserID(dataOf(searched), username)
	}
	if newAPIUserID <= 0 {
		return ShadowIdentity{}, fmt.Errorf("NewAPI did not return a shadow user id")
	}
	if err := c.setShadowUserQuota(ctx, baseURL, adminToken, newAPIUserID, requestID); err != nil {
		return ShadowIdentity{}, fmt.Errorf("set NewAPI shadow user quota: %w", err)
	}

	login, err := c.rawPostJSON(ctx, baseURL+loginPath, "", map[string]string{"username": username, "password": password}, requestID)
	if err != nil {
		return ShadowIdentity{}, fmt.Errorf("log in NewAPI shadow user: %w", err)
	}
	userToken := nestedString(dataOf(login), "token", "access_token")
	if userToken == "" {
		return ShadowIdentity{}, fmt.Errorf("NewAPI login did not return a user token")
	}

	tokenName := username + "-media"
	if _, err := c.rawPostJSONWithHeaders(ctx, baseURL+"/api/token/", userToken, map[string]any{
		"name": tokenName, "expired_time": -1, "remain_quota": 0, "unlimited_quota": true,
		"model_limits_enabled": true, "model_limits": strings.Join(verifiedModels, ","), "group": "default",
	}, requestID, http.Header{"New-Api-User": []string{strconv.FormatInt(newAPIUserID, 10)}}); err != nil {
		return ShadowIdentity{}, fmt.Errorf("create NewAPI media token: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/token/?p=1&size=100", nil)
	if err != nil {
		return ShadowIdentity{}, err
	}
	request.Header.Set("Authorization", "Bearer "+userToken)
	request.Header.Set("New-Api-User", strconv.FormatInt(newAPIUserID, 10))
	request.Header.Set("X-Request-ID", requestID)
	response, err := c.HTTP.Do(request)
	if err != nil {
		return ShadowIdentity{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ShadowIdentity{}, statusError(response)
	}
	var listed map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&listed); err != nil {
		return ShadowIdentity{}, err
	}
	tokenID := findTokenID(dataOf(listed), tokenName)
	if tokenID <= 0 {
		return ShadowIdentity{}, fmt.Errorf("NewAPI media token was not found")
	}

	keyPayload, err := c.rawPostJSONWithHeaders(ctx, fmt.Sprintf("%s/api/token/%d/key", baseURL, tokenID), userToken, map[string]any{}, requestID, http.Header{"New-Api-User": []string{strconv.FormatInt(newAPIUserID, 10)}})
	if err != nil {
		return ShadowIdentity{}, fmt.Errorf("read NewAPI media token: %w", err)
	}
	mediaToken := nestedString(dataOf(keyPayload), "key")
	if mediaToken == "" {
		if direct, ok := dataOf(keyPayload).(string); ok {
			mediaToken = direct
		}
	}
	if mediaToken == "" {
		return ShadowIdentity{}, fmt.Errorf("NewAPI media token was not returned")
	}
	return ShadowIdentity{NewAPIUserID: newAPIUserID, MediaToken: mediaToken}, nil
}

func (c *Client) setShadowUserQuota(ctx context.Context, baseURL, adminToken string, userID int64, requestID string) error {
	_, err := c.rawPostJSON(ctx, baseURL+"/api/user/manage", adminToken, map[string]any{
		"id": userID, "action": "add_quota", "mode": "override", "value": newAPIShadowUserQuota,
	}, requestID)
	return err
}

func (c *Client) FindBill(ctx context.Context, baseURL, adminToken, logPath, newAPIRequestID, requestID string) (Bill, bool, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+logPath+"?request_id="+url.QueryEscape(newAPIRequestID), nil)
	if err != nil {
		return Bill{}, false, err
	}
	request.Header.Set("Authorization", "Bearer "+adminToken)
	request.Header.Set("X-Request-ID", requestID)
	response, err := c.HTTP.Do(request)
	if err != nil {
		return Bill{}, false, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Bill{}, false, statusError(response)
	}
	var payload any
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&payload); err != nil {
		return Bill{}, false, err
	}
	return findBill(payload, newAPIRequestID)
}

func (c *Client) postJSON(ctx context.Context, endpoint, token string, body any, requestID string, output any) error {
	payload, err := c.rawPostJSON(ctx, endpoint, token, body, requestID)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, output)
}

func (c *Client) rawPostJSON(ctx context.Context, endpoint, token string, body any, requestID string) (map[string]any, error) {
	return c.rawPostJSONWithHeaders(ctx, endpoint, token, body, requestID, nil)
}

func (c *Client) rawPostJSONWithHeaders(ctx context.Context, endpoint, token string, body any, requestID string, headers http.Header) (map[string]any, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-ID", requestID)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	for key, values := range headers {
		request.Header[key] = append([]string(nil), values...)
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, statusError(response)
	}
	var payload map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	if err := businessError(payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (c *Client) rawGetJSON(ctx context.Context, endpoint, token, requestID string) (map[string]any, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Request-ID", requestID)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, statusError(response)
	}
	var payload map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	if err := businessError(payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func businessError(payload map[string]any) error {
	success, present := payload["success"].(bool)
	if !present || success {
		return nil
	}
	message, _ := payload["message"].(string)
	message = strings.TrimSpace(message)
	if message == "" {
		return fmt.Errorf("upstream rejected request")
	}
	return fmt.Errorf("upstream rejected request: %s", message)
}

func statusError(response *http.Response) error {
	return fmt.Errorf("upstream status %d", response.StatusCode)
}

func dataOf(value map[string]any) any {
	if data, ok := value["data"]; ok {
		return data
	}
	if result, ok := value["result"]; ok {
		return result
	}
	return value
}

func nestedInt(value any, keys ...string) int64 {
	mapValue, ok := value.(map[string]any)
	if !ok {
		return 0
	}
	for _, key := range keys {
		if number, ok := numeric(mapValue[key]); ok {
			return number
		}
		if nested, ok := mapValue[key].(map[string]any); ok {
			if number := nestedInt(nested, "id"); number > 0 {
				return number
			}
		}
	}
	return 0
}

func nestedString(value any, keys ...string) string {
	mapValue, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range keys {
		if text, ok := mapValue[key].(string); ok && text != "" {
			return text
		}
	}
	return ""
}

func numeric(value any) (int64, bool) {
	switch number := value.(type) {
	case float64:
		return int64(number), number > 0 && math.Trunc(number) == number
	case json.Number:
		parsed, err := number.Int64()
		return parsed, err == nil && parsed > 0
	case string:
		parsed, err := strconv.ParseInt(number, 10, 64)
		return parsed, err == nil && parsed > 0
	default:
		return 0, false
	}
}

func findTokenID(value any, name string) int64 {
	if mapValue, ok := value.(map[string]any); ok {
		for _, key := range []string{"items", "data", "result"} {
			if found := findTokenID(mapValue[key], name); found > 0 {
				return found
			}
		}
		if mapValue["name"] == name {
			return nestedInt(mapValue, "id")
		}
	}
	if list, ok := value.([]any); ok {
		for _, item := range list {
			if found := findTokenID(item, name); found > 0 {
				return found
			}
		}
	}
	return 0
}

func findUserID(value any, username string) int64 {
	if mapValue, ok := value.(map[string]any); ok {
		if mapValue["username"] == username {
			return nestedInt(mapValue, "id")
		}
		for _, child := range mapValue {
			if found := findUserID(child, username); found > 0 {
				return found
			}
		}
	}
	if list, ok := value.([]any); ok {
		for _, child := range list {
			if found := findUserID(child, username); found > 0 {
				return found
			}
		}
	}
	return 0
}

func findBill(value any, newAPIRequestID string) (Bill, bool, error) {
	var candidates []map[string]any
	var visit func(any)
	visit = func(item any) {
		switch typed := item.(type) {
		case []any:
			for _, child := range typed {
				visit(child)
			}
		case map[string]any:
			if fmt.Sprint(typed["request_id"]) == newAPIRequestID {
				candidates = append(candidates, typed)
			}
			for _, child := range typed {
				visit(child)
			}
		}
	}
	visit(value)
	for _, candidate := range candidates {
		for _, quotaField := range []string{"quota", "final_quota", "used_quota"} {
			if quota, ok := numeric(candidate[quotaField]); ok || candidate[quotaField] == float64(0) {
				id := fmt.Sprint(candidate["id"])
				if id == "<nil>" {
					id = newAPIRequestID
				}
				status, _ := candidate["status"].(string)
				return Bill{ID: id, FinalQuota: quota, Status: strings.TrimSpace(status)}, true, nil
			}
		}
	}
	return Bill{}, false, nil
}

func randomSecret() (string, error) {
	// NewAPI validates user passwords as 8–20 characters. Twelve random bytes
	// become a 16-character base64url value, leaving ample entropy while fitting
	// the pinned native API contract.
	secretBytes := make([]byte, 12)
	if _, err := rand.Read(secretBytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(secretBytes), nil
}
