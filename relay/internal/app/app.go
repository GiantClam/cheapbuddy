package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/cheapbuddy/relay/internal/cache"
	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/cryptobox"
	"github.com/cheapbuddy/relay/internal/store"
	"github.com/cheapbuddy/relay/internal/upstream"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

var (
	videoTaskPath    = regexp.MustCompile(`^/v1/(?:videos|video/generations)/[^/]+(?:/content)?$`)
	responseTaskPath = regexp.MustCompile(`^/v1/responses/[^/]+$`)
	imageTaskPath    = regexp.MustCompile(`^/v1/images/tasks/[^/]+$`)
	sunoTaskPath     = regexp.MustCompile(`^/suno/fetch/[^/]+$`)
	taskArtifactPath = regexp.MustCompile(`^/v1/tasks/[^/]+/artifacts/[^/]+/content$`)
	modelDetailPath  = regexp.MustCompile(`^/v1/models/([^/]+)$`)
	mediaAssetPath   = regexp.MustCompile(`^/v1/media/([a-f0-9]{64})$`)
)

type Server struct {
	Config    config.Config
	Store     *store.Store
	Cache     *cache.Cache
	Upstream  *upstream.Client
	Transport http.RoundTripper
	Logger    *slog.Logger
	clock     func() time.Time
	media     *mediaStore
	workers   sync.WaitGroup
}

func New(cfg config.Config, durable *store.Store, cached *cache.Cache, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 512
	transport.MaxIdleConnsPerHost = 128
	transport.IdleConnTimeout = 90 * time.Second
	return &Server{
		Config: cfg, Store: durable, Cache: cached, Upstream: upstream.New(maxDuration(cfg.Sub2APITimeout, cfg.NewAPITimeout)),
		Transport: transport, Logger: logger, clock: time.Now, media: newMediaStore(cfg.MaxBodyBytes),
	}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(s.requestID)
	r.Use(s.cors)
	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)
	r.Get("/v1/usage/dashboard/media", s.handleMediaUsage)
	r.Post("/internal/cache/purge", s.purgeCache)
	r.Handle("/*", http.HandlerFunc(s.handleUserAPI))
	return r
}

func (s *Server) StartReconciler(ctx context.Context) {
	if !s.Config.MediaEnabled {
		return
	}
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		s.reconcile(ctx)
		ticker := time.NewTicker(s.Config.ReconciliationInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.reconcile(ctx)
			}
		}
	}()
}

func (s *Server) Wait() { s.workers.Wait() }

func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := validRequestID(r.Header.Get("X-Request-ID"))
		if id == "" {
			id = newRequestID()
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id)))
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		origin := r.Header.Get("Origin")
		if _, ok := s.Config.AllowedCORSOrigins[origin]; origin != "" && ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-ID,Idempotency-Key")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if s.Config.MediaEnabled && (s.Store == nil || s.Store.Ping(ctx) != nil) {
		writeError(w, http.StatusServiceUnavailable, "storage_unavailable", "Relay storage is unavailable")
		return
	}
	if err := s.Cache.Ping(ctx); err != nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "degraded", "redis": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (s *Server) purgeCache(w http.ResponseWriter, r *http.Request) {
	if !constantTimeEqual(r.Header.Get("X-Relay-Internal-Token"), s.Config.InternalAdminToken) {
		writeError(w, http.StatusUnauthorized, "authentication_error", "Unauthorized")
		return
	}
	var body struct {
		APIKey string `json:"api_key"`
		UserID int64  `json:"user_id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", "Invalid JSON request")
		return
	}
	if body.APIKey != "" {
		_ = s.Cache.DeleteIdentity(r.Context(), body.APIKey)
	}
	if body.UserID > 0 {
		_ = s.Cache.DeleteMapping(r.Context(), body.UserID)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"purged": true})
}

func (s *Server) handleUserAPI(w http.ResponseWriter, r *http.Request) {
	requestID := requestIDFromContext(r.Context())
	pathName := path.Clean(r.URL.Path)
	if pathName == "." {
		pathName = "/"
	}
	if !isAllowedPath(pathName, s.Config) {
		writeError(w, http.StatusNotFound, "not_found", "Route is not available")
		return
	}
	if isMediaAssetPath(pathName) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not available")
			return
		}
		s.handleMediaDownload(w, r, pathName)
		return
	}
	if isTaskArtifactPath(pathName) && r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not available")
		return
	}
	apiKey := bearer(r.Header.Get("Authorization"))
	if apiKey == "" {
		if !s.allowAnonymousRate(r.Context(), r) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
			return
		}
		writeError(w, http.StatusUnauthorized, "authentication_error", "Missing Bearer API key")
		return
	}
	if pathName == "/v1/media" {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not available")
			return
		}
		s.handleMediaUpload(w, r, apiKey, requestID)
		return
	}
	if pathName == "/v1/pricing" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not available")
			return
		}
		if !s.allowTextRate(r.Context(), apiKey) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
			return
		}
		s.handlePricing(w, r, apiKey, requestID)
		return
	}
	if pathName == "/v1/models" || modelDetailPath.MatchString(pathName) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not available")
			return
		}
		if !s.allowTextRate(r.Context(), apiKey) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
			return
		}
		s.handleModels(w, r, apiKey, requestID)
		return
	}
	prepared, err := s.readRouteBody(r, pathName)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	if prepared.body != nil {
		defer prepared.body.Close()
		r.Body = prepared.body
		r.ContentLength = prepared.length
		r = r.WithContext(context.WithValue(r.Context(), requestHashKey{}, prepared.hash))
	}
	model := prepared.model
	if model == "MiniMax-H3" {
		r = r.WithContext(context.WithValue(r.Context(), h3SecondsKey{}, prepared.h3Seconds))
	}
	route := classifyRoute(pathName, model, s.Config)
	if route == routeNone {
		writeError(w, http.StatusNotFound, "not_found", "Route or model is not available")
		return
	}
	if route == routeMediaSubmission && prepared.fullyBuffered {
		// The request body is now independent of the client connection (memory or
		// a temporary file). Keep media submission alive if the client/edge closes
		// the response while NewAPI is still accepting the task.
		submissionTimeout := maxDuration(s.Config.NewAPITimeout, s.Config.StreamIdleTimeout)
		if submissionTimeout <= 0 {
			submissionTimeout = 5 * time.Minute
		}
		submissionCtx, cancelSubmission := context.WithTimeout(context.WithoutCancel(r.Context()), submissionTimeout)
		defer cancelSubmission()
		r = r.WithContext(submissionCtx)
	}
	if route == routeText {
		if !s.allowTextRate(r.Context(), apiKey) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
			return
		}
		if pathName == "/v1/models" {
			s.handleModels(w, r, apiKey, requestID)
			return
		}
		s.proxy(w, r, s.Config.Sub2APIURL, apiKey, requestID, nil)
		return
	}
	if !s.allowAnonymousRate(r.Context(), r) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
		return
	}

	identity, err := s.resolveIdentity(r.Context(), apiKey, requestID)
	if err != nil {
		s.log("identity_failed", requestID, "error", err.Error())
		writeError(w, http.StatusUnauthorized, "authentication_error", "Invalid API key")
		return
	}
	if !s.allowRate(r.Context(), identity, route) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
		return
	}
	if isMediaTaskPoll(pathName) && !s.taskAuthorized(r.Context(), identity.UserID, taskIDFromPath(pathName)) {
		writeError(w, http.StatusNotFound, "not_found", "Task is not available")
		return
	}
	s.handleMedia(w, r, identity, model, apiKey, requestID)
}

func (s *Server) handleMediaUpload(w http.ResponseWriter, r *http.Request, apiKey, requestID string) {
	identity, err := s.resolveIdentity(r.Context(), apiKey, requestID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_error", "Invalid API key")
		return
	}
	if !s.allowRate(r.Context(), identity, routeMediaSubmission) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
		return
	}
	contentType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !isSupportedMediaType(contentType) {
		writeError(w, http.StatusUnsupportedMediaType, "invalid_request_error", "Content-Type must be image, video, or audio")
		return
	}
	maxBytes := s.Config.MaxBodyBytes
	if maxBytes <= 0 {
		maxBytes = 64 << 20
	}
	if r.ContentLength > maxBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid_request_error", "Media exceeds the 64 MiB limit")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil || int64(len(body)) > maxBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "invalid_request_error", "Media exceeds the 64 MiB limit")
		return
	}
	if len(body) == 0 {
		writeError(w, http.StatusBadRequest, "invalid_request_error", "Media body is empty")
		return
	}
	if s.media == nil {
		writeError(w, http.StatusServiceUnavailable, "server_error", "Temporary media storage is unavailable")
		return
	}
	token, expiresAt, err := s.media.put(body, contentType)
	if errors.Is(err, errMediaStoreFull) {
		writeError(w, http.StatusInsufficientStorage, "server_error", "Temporary media storage is full")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "Could not create temporary media URL")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{
		"object":       "media",
		"id":           token,
		"url":          s.mediaURL(r, token),
		"content_type": contentType,
		"expires_at":   expiresAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleMediaDownload(w http.ResponseWriter, r *http.Request, pathName string) {
	matches := mediaAssetPath.FindStringSubmatch(pathName)
	if len(matches) != 2 || s.media == nil {
		writeError(w, http.StatusNotFound, "not_found", "Media is not available")
		return
	}
	blob, ok := s.media.get(matches[1])
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Media is not available")
		return
	}
	w.Header().Set("Content-Type", blob.contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(blob.data)))
	w.Header().Set("Cache-Control", "private, no-store, max-age=0")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(blob.data)
}

func (s *Server) mediaURL(r *http.Request, token string) string {
	base := strings.TrimRight(s.Config.PublicURL, "/")
	if base == "" {
		proto := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0])
		if proto != "http" && proto != "https" {
			proto = "http"
			if r.TLS != nil {
				proto = "https"
			}
		}
		base = proto + "://" + r.Host
	}
	return base + "/v1/media/" + token
}

func isSupportedMediaType(contentType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "image/") ||
		strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "video/") ||
		strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "audio/")
}

func (s *Server) handlePricing(w http.ResponseWriter, r *http.Request, apiKey, requestID string) {
	model := strings.TrimSpace(r.URL.Query().Get("model"))
	if model == "" || len(model) > 200 {
		writeError(w, http.StatusBadRequest, "invalid_request_error", "A valid model query parameter is required")
		return
	}
	if !mediaModelEnabled(s.Config, model) {
		writeError(w, http.StatusNotFound, "model_not_found", "Pricing is not available for this model")
		return
	}
	metadata, err := mediaPricingMetadata(s.Config, model, r.URL.Query())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}

	identity, err := s.resolveIdentity(r.Context(), apiKey, requestID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_error", "Invalid API key")
		return
	}
	mapping, err := s.ensureMapping(r.Context(), identity, requestID)
	if err != nil {
		s.log("pricing_mapping_failed", requestID, "user_id", identity.UserID, "error", err.Error())
		writeError(w, http.StatusServiceUnavailable, "server_error", "Pricing data is unavailable")
		return
	}
	token, err := cryptobox.Decrypt(mapping.NewAPITokenCiphertext, s.Config.TokenEncryptionKey)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "server_error", "Pricing data is unavailable")
		return
	}

	pricing, groupRatios, err := fetchModelPricing(r.Context(), s.Transport, s.Config.NewAPITimeout, s.Config.NewAPIURL, model, token, requestID)
	if errors.Is(err, errPricingModelNotFound) {
		writeError(w, http.StatusNotFound, "model_not_found", "Pricing is not available for this model")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "upstream_error", "Pricing data is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"object":      "cheapbuddy.pricing",
		"model":       model,
		"data":        pricing,
		"group_ratio": groupRatios,
		"cheapbuddy":  metadata,
	})
}

func selectModelPricing(payload map[string]any, model string) (map[string]any, bool) {
	rows, ok := payload["data"].([]any)
	if !ok {
		return nil, false
	}
	for _, row := range rows {
		pricing, ok := row.(map[string]any)
		if !ok {
			continue
		}
		name, ok := pricing["model_name"].(string)
		if ok && strings.EqualFold(strings.TrimSpace(name), strings.TrimSpace(model)) {
			return pricing, true
		}
	}
	return nil, false
}

func (s *Server) handleMediaUsage(w http.ResponseWriter, r *http.Request) {
	apiKey := bearer(r.Header.Get("Authorization"))
	if apiKey == "" {
		writeError(w, http.StatusUnauthorized, "authentication_error", "Missing Bearer API key")
		return
	}
	if s.Store == nil {
		writeError(w, http.StatusServiceUnavailable, "server_error", "Media usage is unavailable")
		return
	}
	identity, err := s.resolveIdentity(r.Context(), apiKey, requestIDFromContext(r.Context()))
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication_error", "Invalid API key")
		return
	}
	now := time.Now
	if s.clock != nil {
		now = s.clock
	}
	start, end, err := mediaUsageRange(r.URL.Query().Get("start_date"), r.URL.Query().Get("end_date"), now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	stats, err := s.Store.MediaUsageByUser(r.Context(), identity.UserID, start, end)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "server_error", "Media usage is unavailable")
		return
	}
	models := make([]map[string]any, 0, len(stats))
	var totalRequests, totalBilledQuota int64
	var totalActualCost float64
	for _, stat := range stats {
		quotaPerUSD := s.Config.QuotaPerUSD
		if quotaPerUSD <= 0 {
			quotaPerUSD = 500000
		}
		actualCost := float64(stat.BilledQuota) / quotaPerUSD
		models = append(models, map[string]any{
			"model":          stat.Model,
			"requests":       stat.Requests,
			"total_requests": stat.Requests,
			"total_tokens":   0,
			"actual_cost":    actualCost,
		})
		totalRequests += stat.Requests
		totalBilledQuota += stat.BilledQuota
		totalActualCost += actualCost
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"models": models,
		"summary": map[string]any{
			"total_requests":     totalRequests,
			"total_billed_quota": totalBilledQuota,
			"total_actual_cost":  totalActualCost,
		},
		"start_date": start.Format("2006-01-02"),
		"end_date":   end.Add(-24 * time.Hour).Format("2006-01-02"),
	})
}

func mediaUsageRange(startValue, endValue string, now time.Time) (time.Time, time.Time, error) {
	end := now.UTC().Truncate(24 * time.Hour).Add(24 * time.Hour)
	start := end.AddDate(0, 0, -30)
	if strings.TrimSpace(startValue) != "" {
		parsed, err := time.Parse("2006-01-02", strings.TrimSpace(startValue))
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("Invalid start_date format, use YYYY-MM-DD")
		}
		start = parsed.UTC()
	}
	if strings.TrimSpace(endValue) != "" {
		parsed, err := time.Parse("2006-01-02", strings.TrimSpace(endValue))
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("Invalid end_date format, use YYYY-MM-DD")
		}
		end = parsed.UTC().Add(24 * time.Hour)
	}
	if !start.Before(end) || end.Sub(start) > 31*24*time.Hour {
		return time.Time{}, time.Time{}, fmt.Errorf("Date range must be between 1 and 31 days")
	}
	return start, end, nil
}

func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request, identity upstream.Identity, model, apiKey, requestID string) {
	mapping, err := s.ensureMapping(r.Context(), identity, requestID)
	if err != nil {
		s.log("mapping_failed", requestID, "user_id", identity.UserID, "error", err.Error())
		writeError(w, http.StatusServiceUnavailable, "server_error", "Media identity is unavailable")
		return
	}
	token, err := cryptobox.Decrypt(mapping.NewAPITokenCiphertext, s.Config.TokenEncryptionKey)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "server_error", "Media identity is unavailable")
		return
	}

	submission := r.Method == http.MethodPost && !isMediaTaskPoll(r.URL.Path)
	if !submission {
		s.proxy(w, r, s.Config.NewAPIURL, token, requestID, nil)
		return
	}
	if !mediaModelEnabled(s.Config, model) {
		writeError(w, http.StatusBadRequest, "invalid_request_error", "Media model is not verified")
		return
	}
	idempotencyKey := mediaIdempotencyKey(r.Header)
	requestHash := requestHashFromContext(r.Context())
	if idempotencyKey != "" {
		if existing, found, err := s.Store.FindMediaByIdempotency(r.Context(), identity.APIKeyID, idempotencyKey); err != nil {
			writeError(w, http.StatusServiceUnavailable, "server_error", "Media request state is unavailable")
			return
		} else if found {
			if existing.RequestHash == "" || requestHash == "" || existing.RequestHash != requestHash {
				writeJSON(w, http.StatusConflict, map[string]any{"error": map[string]string{"type": "idempotency_conflict", "message": "Idempotency-Key was already used with a different request"}, "request_id": existing.RequestID, "task_id": existing.NativeTaskID, "status": existing.BillingStatus})
				return
			}
			// NewAPI does not deduplicate its public Idempotency-Key. Return the
			// durable public identity instead of creating a second provider task.
			s.writeMediaReplay(w, r, existing)
			return
		}
	}
	reservation, err := mediaReservation(s.Config, model, h3SecondsFromContext(r.Context()))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	if err := s.reserve(r.Context(), identity, requestID, reservation); err != nil {
		writeError(w, http.StatusPaymentRequired, "billing_error", "Insufficient balance or reservation unavailable")
		return
	}
	created, err := s.Store.CreateMediaRequest(r.Context(), store.MediaRequest{RequestID: requestID, IdempotencyKey: idempotencyKey, RequestHash: requestHash, Model: model, CheapBuddyUserID: identity.UserID, APIKeyID: identity.APIKeyID, ReservationID: requestID, ReservationAmount: reservation})
	if err != nil || !created {
		_ = s.release(r.Context(), identity, requestID, reservation)
		writeError(w, http.StatusConflict, "idempotency_conflict", "Media request correlation already exists")
		return
	}

	callbacks := &mediaCallbacks{server: s, identity: identity, requestID: requestID, reservation: reservation, model: model}
	s.proxy(w, r, s.Config.NewAPIURL, token, requestID, callbacks)
}

func (s *Server) writeMediaReplay(w http.ResponseWriter, r *http.Request, request store.MediaRequest) {
	if request.NativeTaskID == "" {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":      map[string]string{"type": "accepted_unknown", "message": "The original media task was accepted but its public task ID is not available yet"},
			"request_id": request.RequestID,
			"status":     request.BillingStatus,
		})
		return
	}
	status := "in_progress"
	if request.BillingStatus == "released" {
		status = "failed"
	}
	if r.URL.Path == "/v1/responses" {
		writeJSON(w, http.StatusOK, map[string]any{"id": request.NativeTaskID, "object": "response", "model": request.Model, "status": status})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": request.NativeTaskID, "object": "video", "model": request.Model, "status": status})
}

func (s *Server) proxy(w http.ResponseWriter, r *http.Request, targetURL, authorization, requestID string, callbacks *mediaCallbacks) {
	target, err := url.Parse(targetURL)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "server_error", "Upstream is unavailable")
		return
	}
	proxy := &httputil.ReverseProxy{
		Transport:     s.Transport,
		FlushInterval: -1,
		Director: func(request *http.Request) {
			request.URL.Scheme = target.Scheme
			request.URL.Host = target.Host
			request.Host = target.Host
			stripHopHeaders(request.Header)
			request.Header.Del("Cookie")
			request.Header.Set("Authorization", "Bearer "+authorization)
			request.Header.Set("X-Request-ID", requestID)
		},
		ModifyResponse: func(response *http.Response) error {
			response.Header.Del("Set-Cookie")
			response.Header.Del("WWW-Authenticate")
			response.Header.Del("X-Request-ID")
			if callbacks == nil {
				s.rewriteInsufficientBalanceResponse(response, r.URL.Path)
			}
			if callbacks != nil {
				return callbacks.onResponse(r.Context(), response)
			}
			return nil
		},
		ErrorHandler: func(response http.ResponseWriter, request *http.Request, err error) {
			if callbacks != nil {
				callbacks.onTransportError(request.Context(), err)
			}
			writeError(response, http.StatusGatewayTimeout, "upstream_timeout", "Upstream request timed out")
		},
	}
	proxy.ServeHTTP(w, r)
}

const rechargeURL = "https://cheapbuddy.cc/#pricing"

func (s *Server) rewriteInsufficientBalanceResponse(response *http.Response, pathName string) {
	if response == nil || (response.StatusCode != http.StatusPaymentRequired && response.StatusCode != http.StatusForbidden) {
		return
	}
	if _, ok := s.Config.TextPaths[pathName]; !ok || !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "application/json") {
		return
	}
	const maxErrorBody = 1 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxErrorBody+1))
	if err != nil || len(body) > maxErrorBody {
		response.Body = io.NopCloser(bytes.NewReader(body))
		return
	}
	_ = response.Body.Close()
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil || !isInsufficientBalancePayload(payload) {
		response.Body = io.NopCloser(bytes.NewReader(body))
		return
	}

	message := "CheapBuddy account balance is insufficient / CheapBuddy 账户余额不足，请充值后重试: " + rechargeURL
	rewritten := map[string]any{
		"error": map[string]any{
			"type":         "billing_error",
			"code":         "INSUFFICIENT_BALANCE",
			"message":      message,
			"recharge_url": rechargeURL,
		},
		"recharge_url": rechargeURL,
	}
	encoded, err := json.Marshal(rewritten)
	if err != nil {
		response.Body = io.NopCloser(bytes.NewReader(body))
		return
	}
	response.StatusCode = http.StatusPaymentRequired
	response.Status = fmt.Sprintf("%d %s", response.StatusCode, http.StatusText(response.StatusCode))
	response.Header.Set("Content-Type", "application/json; charset=utf-8")
	response.Header.Set("Cache-Control", "no-store")
	response.Header.Set("Content-Length", fmt.Sprintf("%d", len(encoded)))
	response.ContentLength = int64(len(encoded))
	response.Body = io.NopCloser(bytes.NewReader(encoded))
}

func isInsufficientBalancePayload(payload any) bool {
	switch value := payload.(type) {
	case map[string]any:
		for key, nested := range value {
			switch strings.ToLower(key) {
			case "code", "error_code":
				if strings.EqualFold(strings.TrimSpace(fmt.Sprint(nested)), "INSUFFICIENT_BALANCE") {
					return true
				}
			case "message", "detail":
				message := strings.ToLower(strings.TrimSpace(fmt.Sprint(nested)))
				if strings.Contains(message, "insufficient account balance") || strings.Contains(message, "余额不足") {
					return true
				}
			}
			if isInsufficientBalancePayload(nested) {
				return true
			}
		}
	case []any:
		for _, nested := range value {
			if isInsufficientBalancePayload(nested) {
				return true
			}
		}
	}
	return false
}

func (s *Server) resolveIdentity(ctx context.Context, apiKey, requestID string) (upstream.Identity, error) {
	if cached, found, err := s.Cache.GetIdentity(ctx, apiKey); err == nil && found {
		return upstream.Identity{UserID: cached.UserID, APIKeyID: cached.APIKeyID}, nil
	}
	lookupCtx, cancel := context.WithTimeout(ctx, s.Config.Sub2APITimeout)
	defer cancel()
	identity, err := s.Upstream.ResolveIdentity(lookupCtx, s.Config.Sub2APIURL, s.Config.RelayServiceToken, apiKey, requestID)
	if err != nil {
		return upstream.Identity{}, err
	}
	_ = s.Cache.SetIdentity(ctx, apiKey, cache.Identity{UserID: identity.UserID, APIKeyID: identity.APIKeyID}, s.Config.IdentityTTL)
	return identity, nil
}

func (s *Server) ensureMapping(ctx context.Context, identity upstream.Identity, requestID string) (store.Mapping, error) {
	if cached, found, err := s.Cache.GetMapping(ctx, identity.UserID); err == nil && found && cached.NewAPIUserID > 0 && cached.NewAPITokenCiphertext != "" {
		return cached, nil
	}
	if mapping, found, err := s.Store.FindMapping(ctx, identity.UserID); err != nil {
		return store.Mapping{}, err
	} else if found {
		_ = s.Cache.SetMapping(ctx, mapping, s.Config.MappingTTL)
		return mapping, nil
	}
	lockValue := newRequestID()
	locked, err := s.Cache.AcquireLock(ctx, fmt.Sprintf("provision:%d", identity.UserID), lockValue, 30*time.Second)
	if err != nil {
		return store.Mapping{}, fmt.Errorf("mapping lock unavailable: %w", err)
	}
	if !locked {
		for range 10 {
			time.Sleep(100 * time.Millisecond)
			if mapping, found, err := s.Store.FindMapping(ctx, identity.UserID); err != nil {
				return store.Mapping{}, err
			} else if found {
				return mapping, nil
			}
		}
		return store.Mapping{}, fmt.Errorf("mapping provisioning in progress")
	}
	defer func() {
		_ = s.Cache.ReleaseLock(context.Background(), fmt.Sprintf("provision:%d", identity.UserID), lockValue)
	}()
	if mapping, found, err := s.Store.FindMapping(ctx, identity.UserID); err != nil {
		return store.Mapping{}, err
	} else if found {
		return mapping, nil
	}
	models := sortedModels(s.Config.VerifiedMediaModels)
	provisionCtx, cancel := context.WithTimeout(ctx, s.Config.NewAPITimeout)
	defer cancel()
	created, err := s.Upstream.ProvisionShadowIdentity(provisionCtx, s.Config.NewAPIURL, s.Config.NewAPIAdminToken, s.Config.NewAPIUserPath, s.Config.NewAPILoginPath, identity.UserID, models, requestID)
	if err != nil {
		return store.Mapping{}, err
	}
	ciphertext, err := cryptobox.Encrypt(created.MediaToken, s.Config.TokenEncryptionKey)
	if err != nil {
		return store.Mapping{}, err
	}
	mapping, err := s.Store.SaveMapping(ctx, store.Mapping{CheapBuddyUserID: identity.UserID, Sub2APIAPIKeyID: identity.APIKeyID, NewAPIUserID: created.NewAPIUserID, NewAPITokenCiphertext: ciphertext})
	if err != nil {
		return store.Mapping{}, err
	}
	_ = s.Cache.SetMapping(ctx, mapping, s.Config.MappingTTL)
	return mapping, nil
}

func (s *Server) reserve(ctx context.Context, identity upstream.Identity, requestID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	requestCtx, cancel := context.WithTimeout(ctx, s.Config.Sub2APITimeout)
	defer cancel()
	_, err := s.Upstream.Billing(requestCtx, s.Config.Sub2APIURL, s.Config.RelayServiceToken, "reserve", requestID, map[string]any{"request_id": requestID, "api_key_id": identity.APIKeyID, "user_id": identity.UserID, "amount": amount, "payload_hash": ""})
	return err
}

func (s *Server) release(ctx context.Context, identity upstream.Identity, requestID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	requestCtx, cancel := context.WithTimeout(ctx, s.Config.Sub2APITimeout)
	defer cancel()
	_, err := s.Upstream.Billing(requestCtx, s.Config.Sub2APIURL, s.Config.RelayServiceToken, "release", requestID, map[string]any{"request_id": requestID, "api_key_id": identity.APIKeyID, "user_id": identity.UserID, "amount": amount, "payload_hash": ""})
	return err
}

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request, apiKey, requestID string) {
	modelID := ""
	if matches := modelDetailPath.FindStringSubmatch(path.Clean(r.URL.Path)); len(matches) == 2 {
		decoded, err := url.PathUnescape(matches[1])
		if err != nil || decoded == "" || strings.Contains(decoded, "/") || len(decoded) > 200 {
			writeError(w, http.StatusNotFound, "model_not_found", "Model is not available")
			return
		}
		modelID = decoded
	}
	textPayload, status, err := s.fetchModelsPayload(r, s.Config.Sub2APIURL, apiKey, requestID)
	if err != nil {
		writeModelCatalogError(w, status)
		return
	}
	textRows, ok := modelRows(textPayload)
	if !ok {
		writeError(w, http.StatusBadGateway, "upstream_error", "Invalid model list response")
		return
	}
	rows := make([]any, 0, len(textRows))
	seen := map[string]bool{}
	for _, row := range textRows {
		if item, ok := row.(map[string]any); ok {
			id, ok := item["id"].(string)
			if !ok || id == "" {
				continue
			}
			if _, verified := s.Config.VerifiedMediaModels[id]; verified && !mediaModelVisible(s.Config, id) {
				continue
			}
			rows = append(rows, item)
			seen[id] = true
		}
	}
	mediaRows := []any{}
	mediaToken := ""
	mediaSeen := map[string]bool{}
	if s.Config.MediaEnabled {
		identity, identityErr := s.resolveIdentity(r.Context(), apiKey, requestID)
		if identityErr != nil {
			writeError(w, http.StatusUnauthorized, "authentication_error", "Invalid API key")
			return
		}
		mapping, mappingErr := s.ensureMapping(r.Context(), identity, requestID)
		if mappingErr != nil {
			writeError(w, http.StatusServiceUnavailable, "server_error", "Media model list unavailable")
			return
		}
		token, decryptErr := cryptobox.Decrypt(mapping.NewAPITokenCiphertext, s.Config.TokenEncryptionKey)
		if decryptErr != nil {
			writeError(w, http.StatusServiceUnavailable, "server_error", "Media model list unavailable")
			return
		}
		mediaToken = token
		mediaPayload, mediaStatus, fetchErr := s.fetchModelsPayload(r, s.Config.NewAPIURL, token, requestID)
		if fetchErr != nil {
			writeError(w, mediaStatus, "upstream_error", "Media model list unavailable")
			return
		}
		mediaRows, ok = modelRows(mediaPayload)
		if !ok {
			writeError(w, http.StatusBadGateway, "upstream_error", "Invalid media model list response")
			return
		}
	}
	mediaCatalogModels := make(map[string]struct{})
	unclassifiedMediaCatalogModels := make(map[string]struct{})
	mediaDetailsByID := make(map[string]map[string]any)
	for index, row := range mediaRows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		item = normalizeModelMetadata(item)
		id, ok := item["id"].(string)
		if !ok || id == "" {
			continue
		}
		_, verifiedMediaModel := s.Config.VerifiedMediaModels[id]
		if !hasMediaModelClassification(item) && !hasExplicitTextClassification(item) && (seen[id] || verifiedMediaModel) {
			detail, detailStatus, detailErr := s.fetchModelDetail(r, s.Config.NewAPIURL, mediaToken, id, requestID)
			if detailErr != nil {
				logger := s.Logger
				if logger == nil {
					logger = slog.Default()
				}
				logger.Warn("relay_media_model_metadata_unavailable", "model_id", id, "status", detailStatus)
			} else {
				item = mergeModelMetadata(item, detail)
			}
		}
		mediaRows[index] = item
		mediaDetailsByID[id] = item
		if hasMediaModelClassification(item) {
			mediaCatalogModels[id] = struct{}{}
		} else if !hasExplicitTextClassification(item) && seen[id] {
			// A matching NewAPI row whose detail is still unclassified must not
			// inherit a synthetic text type from the Sub2API catalog.
			unclassifiedMediaCatalogModels[id] = struct{}{}
		}
	}
	classifiedRows := make([]any, 0, len(rows))
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		item = applyKnownModelMetadata(item)
		id, _ := item["id"].(string)
		if mediaItem, found := mediaDetailsByID[id]; found {
			if hasMediaModelClassification(mediaItem) && !hasExplicitTextClassification(mediaItem) && !mediaModelConfigured(s.Config, id) {
				continue
			}
			if _, unresolved := unclassifiedMediaCatalogModels[id]; unresolved && !hasExplicitTextClassification(item) && !hasKnownModelMetadata(item) {
				continue
			}
			item = mergeModelMetadata(item, mediaItem)
		} else if _, unresolved := unclassifiedMediaCatalogModels[id]; unresolved && !hasExplicitTextClassification(item) && !hasKnownModelMetadata(item) {
			continue
		}
		if isKnownMediaModelID(id) && !mediaModelConfigured(s.Config, id) && !hasKnownModelMetadata(item) {
			continue
		}
		classifiedRows = append(classifiedRows, classifySub2APITextModel(item, mediaCatalogModels, unclassifiedMediaCatalogModels, s.Config.VerifiedMediaModels))
	}
	rows = classifiedRows
	for _, row := range mediaRows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		id, ok := item["id"].(string)
		if !ok || !mediaModelVisible(s.Config, id) {
			continue
		}
		if _, verified := s.Config.VerifiedMediaModels[id]; !verified {
			continue
		}
		if _, priced := s.Config.MediaMultiplierByModel[id]; !priced {
			continue
		}
		if _, reserved := s.Config.ReservationQuotaByModel[id]; !reserved {
			continue
		}
		item = normalizeModelMetadata(item)
		if item["object"] == nil {
			item["object"] = "model"
		}
		if item["owned_by"] == nil {
			item["owned_by"] = "cheapbuddy"
		}
		mediaSeen[id] = true
		if seen[id] {
			for index, row := range rows {
				base, ok := row.(map[string]any)
				if !ok || base["id"] != id {
					continue
				}
				rows[index] = applyConfiguredMediaCapabilities(mergeModelMetadata(base, item), s.Config.MediaCapabilitiesByModel)
				break
			}
			continue
		}
		rows = append(rows, applyConfiguredMediaCapabilities(item, s.Config.MediaCapabilitiesByModel))
		seen[id] = true
	}
	if modelID != "" {
		if item, ok := hiddenMediaDetailItem(s.Config, modelID, mediaDetailsByID); ok {
			rows = append(rows, item)
			mediaSeen[modelID] = true
		}
		for _, row := range rows {
			if item, ok := row.(map[string]any); ok && item["id"] == modelID {
				baseURL, token := s.Config.Sub2APIURL, apiKey
				if mediaSeen[modelID] {
					baseURL, token = s.Config.NewAPIURL, mediaToken
				}
				detail, detailStatus, detailErr := s.fetchModelDetail(r, baseURL, token, modelID, requestID)
				if detailErr != nil {
					if detailStatus == http.StatusNotFound && (mediaSeen[modelID] || hasTextModelClassification(item) || hasKnownModelMetadata(item)) {
						detail = cloneJSONMap(item)
					} else {
						writeError(w, detailStatus, "upstream_error", "Model details unavailable")
						return
					}
				}
				detail = applyKnownModelMetadata(mergeModelMetadata(item, detail))
				if detail["id"] == nil {
					detail["id"] = item["id"]
				}
				if detail["object"] == nil {
					detail["object"] = item["object"]
				}
				if detail["owned_by"] == nil {
					detail["owned_by"] = item["owned_by"]
				}
				writeJSON(w, http.StatusOK, detail)
				return
			}
		}
		writeError(w, http.StatusNotFound, "model_not_found", "Model is not available")
		return
	}
	textPayload["data"] = rows
	writeJSON(w, http.StatusOK, textPayload)
}

func (s *Server) fetchModelDetail(r *http.Request, baseURL, token, modelID, requestID string) (map[string]any, int, error) {
	ctx, cancel := context.WithTimeout(r.Context(), s.Config.Sub2APITimeout)
	defer cancel()
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/models/" + url.PathEscape(modelID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, http.StatusServiceUnavailable, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Request-ID", requestID)
	resp, err := (&http.Client{Transport: s.Transport, Timeout: s.Config.Sub2APITimeout}).Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, http.StatusNotFound, errors.New("model not found")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, http.StatusBadGateway, errors.New("upstream model detail failed")
	}
	var payload map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, http.StatusBadGateway, err
	}
	if data, ok := payload["data"].(map[string]any); ok {
		payload = data
	}
	if id, ok := payload["id"].(string); ok && id != modelID {
		return nil, http.StatusBadGateway, errors.New("upstream returned a different model")
	}
	return payload, http.StatusOK, nil
}

func (s *Server) fetchModelsPayload(r *http.Request, baseURL, token, requestID string) (map[string]any, int, error) {
	ctx, cancel := context.WithTimeout(r.Context(), s.Config.Sub2APITimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+"/v1/models", nil)
	if err != nil {
		return nil, http.StatusServiceUnavailable, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Request-ID", requestID)
	resp, err := (&http.Client{Transport: s.Transport, Timeout: s.Config.Sub2APITimeout}).Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Sub2API authenticates the caller's Key; its permission failures are
		// actionable by the desktop. NewAPI authenticates a server-owned shadow
		// token, so its auth failures remain upstream errors at this boundary.
		if baseURL == s.Config.Sub2APIURL {
			switch resp.StatusCode {
			case http.StatusUnauthorized, http.StatusForbidden, http.StatusTooManyRequests:
				return nil, resp.StatusCode, fmt.Errorf("customer catalog status %d", resp.StatusCode)
			}
		}
		return nil, http.StatusBadGateway, fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	var payload map[string]any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, http.StatusBadGateway, err
	}
	return payload, http.StatusOK, nil
}

func modelRows(payload map[string]any) ([]any, bool) {
	rows, ok := payload["data"].([]any)
	if ok {
		return rows, true
	}
	if item, found := payload["id"].(string); found && item != "" {
		return []any{payload}, true
	}
	return nil, false
}

func cloneJSONMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

// Sub2API's /v1/models catalog is the source catalog for Relay's text routes.
// NewAPI's catalog is the source of image/video classification and takes
// precedence when a model appears in both catalogs without explicit text
// capability metadata. Sub2API's generic OpenAI endpoint metadata alone does
// not identify a model's modality, so generic rows default to text.
func classifySub2APITextModel(item map[string]any, mediaCatalogModels, unclassifiedMediaCatalogModels, verifiedMediaModels map[string]struct{}) map[string]any {
	item = applyKnownModelMetadata(item)
	id, _ := item["id"].(string)
	if hasMediaModelClassification(item) || hasExplicitTextClassification(item) || isTextModelType(fmt.Sprint(item["type"])) {
		return item
	}
	if _, isMediaModel := mediaCatalogModels[id]; isMediaModel {
		return item
	}
	if _, isUnclassifiedMediaModel := unclassifiedMediaCatalogModels[id]; isUnclassifiedMediaModel {
		return item
	}
	if _, isMediaModel := verifiedMediaModels[id]; isMediaModel {
		return item
	}
	classified := cloneJSONMap(item)
	classified["type"] = "text"
	classified["capabilities"] = mergeMetadataValues(classified["capabilities"], []any{"text_generation"})
	return classified
}

// applyKnownModelMetadata fills gaps in upstream catalogs where a model is
// published as a generic OpenAI-compatible object without its actual modality.
func applyKnownModelMetadata(item map[string]any) map[string]any {
	id, _ := item["id"].(string)
	if id == "MiniMax-H3" {
		classified := cloneJSONMap(item)
		upstreamSchema, _ := item["parameter_schema"].(map[string]any)
		schema := cloneJSONMap(upstreamSchema)
		for name, kind := range map[string]string{
			"first_frame": "image", "last_frame": "image",
			"reference_video": "video", "reference_audio": "audio",
		} {
			if _, exists := schema[name]; !exists {
				schema[name] = map[string]any{"type": kind, "optional": true}
			}
		}
		if _, exists := schema["ratio"]; !exists {
			schema["ratio"] = map[string]any{
				"type": "string", "options": []any{"16:9", "9:16", "1:1", "21:9", "4:3", "3:4", "adaptive"},
				"default": "16:9", "optional": true,
			}
		}
		classified["parameter_schema"] = schema
		return classified
	}
	if id != "grok-imagine-image-2.0" {
		return item
	}
	classified := cloneJSONMap(item)
	classified["type"] = "image"
	// Grok Imagine 2.0 accepts text plus one or more input images on the
	// images/edits endpoint. Keep these capabilities in the Relay catalog so
	// clients can expose image-to-image and multi-image workflows without
	// inventing a provider-specific node. The upstream adapter remains the
	// final request-shape and authorization boundary.
	classified["capabilities"] = mergeMetadataValues(classified["capabilities"], []any{"text_to_image", "image_edit", "variation"})
	upstreamSchema, _ := item["parameter_schema"].(map[string]any)
	schema := cloneJSONMap(upstreamSchema)
	if _, exists := schema["n"]; !exists {
		schema["n"] = map[string]any{
			"type": "integer", "default": 1, "minimum": 1, "maximum": 128, "optional": true,
			"description": "Number of images to return.",
		}
	}
	if _, exists := schema["quality"]; !exists {
		schema["quality"] = map[string]any{
			"type": "string", "options": []any{"auto", "low", "medium"},
			"default": "auto", "optional": true,
		}
	}
	if _, exists := schema["response_format"]; !exists {
		schema["response_format"] = map[string]any{
			"type": "string", "options": []any{"b64_json", "url"},
			"default": "b64_json", "optional": true,
		}
	}
	classified["parameter_schema"] = schema
	return classified
}

func hasKnownModelMetadata(item map[string]any) bool {
	id, _ := item["id"].(string)
	return id == "grok-imagine-image-2.0"
}

func isKnownMediaModelID(id string) bool {
	return strings.HasPrefix(id, "gpt-image-") ||
		strings.HasPrefix(id, "grok-imagine-image") ||
		strings.HasPrefix(id, "grok-video-") ||
		id == "grok-image-video"
}

func hasMediaModelClassification(item map[string]any) bool {
	switch strings.ToLower(strings.TrimSpace(fmt.Sprint(item["type"]))) {
	case "image", "image_generation", "video", "video_generation":
		return true
	}
	capabilities, _ := item["capabilities"].([]any)
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(fmt.Sprint(capability))) {
		case "text_to_image", "image_edit", "variation", "text_to_video", "image_to_video", "reference_to_video":
			return true
		}
	}
	if supported, ok := item["supported_endpoint_types"].([]any); ok {
		for _, endpoint := range supported {
			switch strings.ToLower(strings.TrimSpace(fmt.Sprint(endpoint))) {
			case "image-generation", "openai-video":
				return true
			}
		}
	}
	return false
}

func mergeModelMetadata(listItem, detail map[string]any) map[string]any {
	merged := cloneJSONMap(listItem)
	for _, key := range []string{"type", "capabilities", "parameter_schema", "supported_endpoint_types"} {
		value, found := detail[key]
		if !found || value == nil {
			continue
		}
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
			continue
		}
		if capabilities, ok := value.([]any); ok && len(capabilities) == 0 {
			continue
		}
		if key == "capabilities" || key == "supported_endpoint_types" {
			merged[key] = mergeMetadataValues(merged[key], value)
			continue
		}
		if key == "type" {
			if existing, ok := merged[key].(string); ok && strings.TrimSpace(existing) != "" {
				incomingType, _ := value.(string)
				if isTextModelType(existing) && isMediaModelType(incomingType) && !hasExplicitTextClassification(merged) {
					merged[key] = value
				}
				continue
			}
		}
		merged[key] = value
	}
	return normalizeModelMetadata(merged)
}

func isTextModelType(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "text", "language", "llm", "vision", "chat", "chat.completion":
		return true
	default:
		return false
	}
}

func isMediaModelType(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image", "image_generation", "video", "video_generation":
		return true
	default:
		return false
	}
}

func hasExplicitTextClassification(item map[string]any) bool {
	for _, value := range []any{item["capabilities"], item["supported_endpoint_types"]} {
		values, _ := value.([]any)
		for _, candidate := range values {
			text, ok := candidate.(string)
			if !ok {
				continue
			}
			switch strings.ToLower(strings.TrimSpace(text)) {
			case "text_generation", "vision", "openai-response", "anthropic", "gemini":
				return true
			}
		}
	}
	return false
}

func hasTextModelClassification(item map[string]any) bool {
	modelType, _ := item["type"].(string)
	return isTextModelType(modelType) || hasExplicitTextClassification(item)
}

func mergeMetadataValues(existing, incoming any) []any {
	values := make([]any, 0)
	seen := make(map[string]struct{})
	for _, value := range []any{existing, incoming} {
		items, ok := value.([]any)
		if !ok {
			continue
		}
		for _, item := range items {
			var key string
			if text, ok := item.(string); ok {
				key = strings.ToLower(strings.TrimSpace(text))
			} else {
				encoded, err := json.Marshal(item)
				if err != nil {
					key = fmt.Sprintf("%T:%v", item, item)
				} else {
					key = string(encoded)
				}
			}
			if _, found := seen[key]; found {
				continue
			}
			seen[key] = struct{}{}
			values = append(values, item)
		}
	}
	return values
}

func normalizeModelMetadata(item map[string]any) map[string]any {
	normalized := applyKnownModelMetadata(item)
	endpoints, ok := normalized["supported_endpoint_types"].([]any)
	if !ok {
		return normalized
	}
	modelType, _ := normalized["type"].(string)
	capabilities, _ := normalized["capabilities"].([]any)
	capabilitySet := make(map[string]struct{}, len(capabilities))
	for _, capability := range capabilities {
		if value, ok := capability.(string); ok {
			capabilitySet[strings.ToLower(strings.TrimSpace(value))] = struct{}{}
		}
	}
	for _, endpoint := range endpoints {
		switch strings.ToLower(strings.TrimSpace(fmt.Sprint(endpoint))) {
		case "image-generation":
			if strings.TrimSpace(modelType) == "" {
				modelType = "image"
			}
			if _, found := capabilitySet["text_to_image"]; !found {
				capabilities = append(capabilities, "text_to_image")
				capabilitySet["text_to_image"] = struct{}{}
			}
		case "openai-video":
			if strings.TrimSpace(modelType) == "" {
				modelType = "video"
			}
			if _, found := capabilitySet["text_to_video"]; !found {
				capabilities = append(capabilities, "text_to_video")
				capabilitySet["text_to_video"] = struct{}{}
			}
		}
	}
	if strings.TrimSpace(modelType) != "" {
		normalized["type"] = modelType
	}
	if len(capabilities) > 0 {
		normalized["capabilities"] = capabilities
	}
	return normalized
}

func applyConfiguredMediaCapabilities(item map[string]any, configured map[string][]string) map[string]any {
	id, _ := item["id"].(string)
	capabilities, ok := configured[id]
	if !ok || len(capabilities) == 0 {
		return item
	}
	merged := cloneJSONMap(item)
	incoming := make([]any, len(capabilities))
	for index, capability := range capabilities {
		incoming[index] = capability
	}
	merged["capabilities"] = mergeMetadataValues(merged["capabilities"], incoming)
	if modelType, ok := merged["type"].(string); !ok || strings.TrimSpace(modelType) == "" {
		for _, capability := range capabilities {
			switch capability {
			case "text_to_video", "image_to_video", "reference_to_video":
				merged["type"] = "video"
			case "text_to_image", "image_edit", "variation":
				if merged["type"] == nil {
					merged["type"] = "image"
				}
			}
		}
	}
	return merged
}

func (s *Server) taskAuthorized(ctx context.Context, userID int64, taskID string) bool {
	if taskID == "" {
		return false
	}
	ok, err := s.Store.TaskBelongsToUser(ctx, userID, taskID)
	return err == nil && ok
}

func (s *Server) allowRate(ctx context.Context, identity upstream.Identity, route routeClass) bool {
	limit := s.Config.TextRateLimit
	class := "text"
	if route == routeMediaSubmission {
		limit, class = s.Config.MediaSubmissionRateLimit, "media_submission"
	}
	if route == routeMediaPoll {
		limit, class = s.Config.MediaPollRateLimit, "media_poll"
	}
	allowed, _, err := s.Cache.Allow(ctx, fmt.Sprintf("%s:key:%d:user:%d", class, identity.APIKeyID, identity.UserID), limit, s.Config.RateWindow)
	if err != nil {
		s.Logger.Warn("relay_cache_rate_limit_degraded", "route", class, "error", err.Error())
		return true
	}
	return allowed
}

func (s *Server) allowTextRate(ctx context.Context, apiKey string) bool {
	keyHash := sha256.Sum256([]byte(apiKey))
	allowed, _, err := s.Cache.Allow(ctx, fmt.Sprintf("text:key:%x", keyHash), s.Config.TextRateLimit, s.Config.RateWindow)
	if err != nil {
		s.Logger.Warn("relay_cache_rate_limit_degraded", "route", "text", "error", err.Error())
		return true
	}
	return allowed
}

func (s *Server) allowAnonymousRate(ctx context.Context, request *http.Request) bool {
	clientIP, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil || clientIP == "" {
		clientIP = request.RemoteAddr
	}
	allowed, _, err := s.Cache.Allow(ctx, "auth:ip:"+clientIP, s.Config.AuthRateLimit, s.Config.RateWindow)
	if err != nil {
		s.Logger.Warn("relay_cache_auth_rate_limit_degraded", "error", err.Error())
		return true
	}
	return allowed
}

type mediaCallbacks struct {
	server             *Server
	identity           upstream.Identity
	requestID          string
	reservation        int64
	model              string
	observedMu         sync.Mutex
	observedNativeID   string
	observedProviderID string
}

func (c *mediaCallbacks) onResponse(ctx context.Context, response *http.Response) error {
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode >= 500 {
			stateCtx, cancel := c.durableContext(ctx)
			defer cancel()
			_ = c.server.Store.MarkBilling(stateCtx, c.requestID, "pending_reconciliation", 0, "", "", "NewAPI returned an ambiguous server error")
			return nil
		}
		releaseCtx, releaseCancel := c.durableContext(ctx)
		releaseErr := c.server.release(releaseCtx, c.identity, c.requestID, c.reservation)
		releaseCancel()
		if releaseErr != nil {
			stateCtx, cancel := c.durableContext(ctx)
			defer cancel()
			_ = c.server.Store.MarkBilling(stateCtx, c.requestID, "pending_reconciliation", 0, "", "", "release failed")
		} else {
			stateCtx, cancel := c.durableContext(ctx)
			defer cancel()
			_ = c.server.Store.MarkBilling(stateCtx, c.requestID, "released", 0, "", "", "NewAPI rejected request")
		}
		return nil
	}
	stateCtx, stateCancel := c.durableContext(ctx)
	defer stateCancel()
	nativeRequestID := newAPIRequestID(response)
	if nativeRequestID == "" {
		if err := c.server.Store.MarkBilling(stateCtx, c.requestID, "pending_reconciliation", 0, "", "", "NewAPI request ID was not available"); err != nil {
			c.server.log("newapi_request_id_missing_persist_failed", c.requestID, "error", err.Error())
		}
	} else if err := c.server.Store.AttachNewAPIRequestID(stateCtx, c.requestID, nativeRequestID); err != nil {
		c.server.log("newapi_request_id_persist_failed", c.requestID, "error", err.Error())
		_ = c.server.Store.MarkBilling(stateCtx, c.requestID, "pending_reconciliation", 0, "", "", "NewAPI request ID persistence failed")
	}
	if strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		response.Body = &observedSSEBody{
			source: response.Body,
			onIDs: func(nativeID, providerID string) {
				c.persistObservedIDs(nativeID, providerID)
			},
		}
		return nil
	}
	if !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "json") {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20+1))
	if err != nil {
		return err
	}
	if len(body) > 1<<20 {
		response.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	if taskID := nativeTaskID(payload); taskID != "" {
		if err := c.server.Store.AttachNativeTask(stateCtx, c.requestID, taskID); err != nil {
			c.server.log("native_task_persist_failed", c.requestID, "error", err.Error())
		}
	}
	if taskID := providerTaskID(payload); taskID != "" {
		if err := c.server.Store.AttachProviderTask(stateCtx, c.requestID, taskID); err != nil {
			c.server.log("provider_task_persist_failed", c.requestID, "error", err.Error())
		}
	}
	return nil
}

func (c *mediaCallbacks) persistObservedIDs(nativeID, providerID string) {
	if c.server == nil || c.server.Store == nil {
		return
	}
	nativeID = strings.TrimSpace(nativeID)
	providerID = strings.TrimSpace(providerID)
	if nativeID == "" && providerID == "" {
		return
	}
	c.observedMu.Lock()
	if nativeID == c.observedNativeID {
		nativeID = ""
	} else if nativeID != "" {
		c.observedNativeID = nativeID
	}
	if providerID == c.observedProviderID {
		providerID = ""
	} else if providerID != "" {
		c.observedProviderID = providerID
	}
	c.observedMu.Unlock()
	if nativeID == "" && providerID == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if nativeID != "" {
			if err := c.server.Store.AttachNativeTask(ctx, c.requestID, nativeID); err != nil {
				c.server.log("native_task_sse_persist_failed", c.requestID, "error", err.Error())
			}
		}
		if providerID != "" {
			if err := c.server.Store.AttachProviderTask(ctx, c.requestID, providerID); err != nil {
				c.server.log("provider_task_sse_persist_failed", c.requestID, "error", err.Error())
			}
		}
	}()
}

type observedSSEBody struct {
	source io.ReadCloser
	onIDs  func(nativeID, providerID string)
	buffer []byte
}

func (b *observedSSEBody) Read(p []byte) (int, error) {
	n, err := b.source.Read(p)
	if n > 0 {
		b.buffer = append(b.buffer, p[:n]...)
		b.consumeLines()
		if len(b.buffer) > 64*1024 {
			b.buffer = append([]byte(nil), b.buffer[len(b.buffer)-64*1024:]...)
		}
	}
	return n, err
}

func (b *observedSSEBody) Close() error { return b.source.Close() }

func (b *observedSSEBody) consumeLines() {
	for {
		index := bytes.IndexByte(b.buffer, '\n')
		if index < 0 {
			return
		}
		line := bytes.TrimSuffix(b.buffer[:index], []byte{'\r'})
		b.buffer = b.buffer[index+1:]
		nativeID, providerID := taskIDsFromSSELine(line)
		if b.onIDs != nil && (nativeID != "" || providerID != "") {
			b.onIDs(nativeID, providerID)
		}
	}
}

func taskIDsFromSSELine(line []byte) (string, string) {
	line = bytes.TrimSpace(line)
	if !bytes.HasPrefix(line, []byte("data:")) {
		return "", ""
	}
	data := bytes.TrimSpace(bytes.TrimPrefix(line, []byte("data:")))
	if len(data) == 0 || bytes.Equal(data, []byte("[DONE]")) {
		return "", ""
	}
	var payload any
	if json.Unmarshal(data, &payload) != nil {
		return "", ""
	}
	return nativeSSETaskID(payload), providerTaskID(payload)
}

func nativeSSETaskID(value any) string {
	if typed, ok := value.(map[string]any); ok {
		for _, key := range []string{"response", "data", "result"} {
			if nested, found := typed[key]; found {
				if id := nativeTaskID(nested); id != "" {
					return id
				}
			}
		}
	}
	return nativeTaskID(value)
}

func (c *mediaCallbacks) onTransportError(ctx context.Context, _ error) {
	stateCtx, cancel := c.durableContext(ctx)
	defer cancel()
	_ = c.server.Store.MarkBilling(stateCtx, c.requestID, "pending_reconciliation", 0, "", "", "submission timeout or network error")
}

// durableContext keeps billing and correlation writes alive after a client
// disconnects. ReverseProxy callbacks run on the client request context, but
// these writes are the source of truth for wallet reconciliation.
func (c *mediaCallbacks) durableContext(parent context.Context) (context.Context, context.CancelFunc) {
	timeout := maxDuration(c.server.Config.Sub2APITimeout, 5*time.Second)
	return context.WithTimeout(context.WithoutCancel(parent), timeout)
}

func (s *Server) reconcile(ctx context.Context) {
	lockValue := newRequestID()
	locked, err := s.Cache.AcquireLock(ctx, "reconcile", lockValue, 45*time.Second)
	if err != nil || !locked {
		return
	}
	defer func() { _ = s.Cache.ReleaseLock(context.Background(), "reconcile", lockValue) }()
	requests, err := s.Store.PendingRequests(ctx, s.Config.ReconciliationBatchSize)
	if err != nil {
		s.Logger.Error("relay_reconcile_load_failed", "error", err.Error())
		return
	}
	for _, request := range requests {
		if request.NewAPIRequestID == "" {
			continue
		}
		billCtx, cancel := context.WithTimeout(ctx, s.Config.NewAPITimeout)
		bill, found, err := s.Upstream.FindBill(billCtx, s.Config.NewAPIURL, s.Config.NewAPIAdminToken, s.Config.NewAPILogPath, request.NewAPIRequestID, request.RequestID)
		cancel()
		if err != nil {
			_ = s.Store.MarkBilling(ctx, request.RequestID, "pending_reconciliation", 0, "", "", "native bill lookup failed")
			continue
		}
		if !found {
			_ = s.Store.MarkBilling(ctx, request.RequestID, "pending_reconciliation", 0, "", "", "native bill unavailable")
			continue
		}
		multiplier, ok := s.Config.MediaMultiplierByModel[request.Model]
		if !ok {
			_ = s.Store.MarkBilling(ctx, request.RequestID, "pending_reconciliation", 0, bill.ID, "", "media multiplier unavailable")
			continue
		}
		amount, release := settlementAmount(bill, multiplier)
		if release {
			releaseCtx, releaseCancel := context.WithTimeout(ctx, s.Config.Sub2APITimeout)
			releaseErr := s.release(releaseCtx, upstream.Identity{UserID: request.CheapBuddyUserID, APIKeyID: request.APIKeyID}, request.RequestID, request.ReservationAmount)
			releaseCancel()
			if releaseErr != nil {
				_ = s.Store.MarkBilling(ctx, request.RequestID, "pending_reconciliation", 0, bill.ID, "", "release failed")
				continue
			}
			_ = s.Store.MarkBilling(ctx, request.RequestID, "released", 0, bill.ID, "", "NewAPI task completed without billable output")
			continue
		}
		captureCtx, cancel := context.WithTimeout(ctx, s.Config.Sub2APITimeout)
		response, err := s.Upstream.Billing(captureCtx, s.Config.Sub2APIURL, s.Config.RelayServiceToken, "capture", request.RequestID, map[string]any{"request_id": request.RequestID, "api_key_id": request.APIKeyID, "user_id": request.CheapBuddyUserID, "held_amount": request.ReservationAmount, "actual_amount": amount, "payload_hash": ""})
		cancel()
		if err != nil {
			_ = s.Store.MarkBilling(ctx, request.RequestID, "pending_reconciliation", bill.FinalQuota, bill.ID, "", "capture failed")
			continue
		}
		ledgerID, _ := response["billing_request_id"].(string)
		_ = s.Store.MarkBilling(ctx, request.RequestID, "settled", amount, bill.ID, ledgerID, "")
	}
}

type routeClass int

const (
	routeNone routeClass = iota
	routeText
	routeMediaSubmission
	routeMediaPoll
)

type requestIDKey struct{}
type requestHashKey struct{}

func classifyRoute(pathName, model string, cfg config.Config) routeClass {
	if pathName == "/v1/models" {
		return routeText
	}
	if isMediaTaskPoll(pathName) && cfg.MediaEnabled {
		return routeMediaPoll
	}
	if _, ok := cfg.MediaPaths[pathName]; ok && cfg.MediaEnabled {
		return routeMediaSubmission
	}
	if _, ok := cfg.TextPaths[pathName]; ok {
		if _, verified := cfg.VerifiedMediaModels[model]; verified && !mediaModelEnabled(cfg, model) {
			return routeNone
		}
		if mediaModelEnabled(cfg, model) {
			return routeMediaSubmission
		}
		return routeText
	}
	return routeNone
}

func isAllowedPath(pathName string, cfg config.Config) bool {
	if pathName == "/v1/models" || modelDetailPath.MatchString(pathName) || (pathName == "/v1/pricing" && cfg.MediaEnabled) || (isMediaTaskPoll(pathName) && cfg.MediaEnabled) || (pathName == "/v1/media" && cfg.MediaEnabled) || (isMediaAssetPath(pathName) && cfg.MediaEnabled) {
		return true
	}
	if _, ok := cfg.TextPaths[pathName]; ok {
		return true
	}
	_, ok := cfg.MediaPaths[pathName]
	return ok && cfg.MediaEnabled
}

func isMediaAssetPath(pathName string) bool {
	return mediaAssetPath.MatchString(pathName)
}

func isMediaSubmission(pathName string) bool {
	return strings.Contains(pathName, "/images/") ||
		pathName == "/v1/videos" ||
		pathName == "/v1/video/generations" ||
		strings.HasPrefix(pathName, "/v1/audio/") ||
		strings.HasPrefix(pathName, "/suno/submit/")
}

func isMediaTaskPoll(pathName string) bool {
	if pathName == "/v1/responses/compact" {
		return false
	}
	return videoTaskPath.MatchString(pathName) || responseTaskPath.MatchString(pathName) || imageTaskPath.MatchString(pathName) || sunoTaskPath.MatchString(pathName) || isTaskArtifactPath(pathName)
}

func isTaskArtifactPath(pathName string) bool {
	return taskArtifactPath.MatchString(pathName)
}

func taskIDFromPath(pathName string) string {
	if isTaskArtifactPath(pathName) {
		parts := strings.Split(pathName, "/")
		if len(parts) >= 4 {
			return parts[3]
		}
	}
	return path.Base(strings.TrimSuffix(pathName, "/content"))
}

type preparedRouteBody struct {
	body          io.ReadCloser
	length        int64
	model         string
	hash          string
	fullyBuffered bool
	h3Seconds     int
}

func (s *Server) readRouteBody(r *http.Request, pathName string) (preparedRouteBody, error) {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Body == nil {
		return preparedRouteBody{}, nil
	}
	requiresModel := isMediaSubmission(pathName)
	if _, textPath := s.Config.TextPaths[pathName]; textPath {
		requiresModel = true
	}
	if !requiresModel {
		return preparedRouteBody{}, nil
	}
	contentType := r.Header.Get("Content-Type")
	if strings.Contains(strings.ToLower(contentType), "multipart/form-data") {
		if mediaIdempotencyKey(r.Header) != "" {
			return s.spoolMultipartBody(r, contentType)
		}
		prepared, err := inspectMultipartBody(r, contentType)
		if err != nil || prepared.model != "MiniMax-H3" {
			return prepared, err
		}
		// H3 duration may follow reference files. Spool its complete body before
		// computing a hold, keeping original bytes and multipart identity intact.
		r.Body = prepared.body
		return s.spoolMultipartBody(r, contentType)
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, s.Config.MaxBodyBytes+1))
	if err != nil || int64(len(body)) > s.Config.MaxBodyBytes {
		return preparedRouteBody{}, fmt.Errorf("request body too large")
	}
	model := extractModel(body, contentType)
	seconds := 0
	if model == "MiniMax-H3" {
		seconds, err = h3JSONSeconds(body)
		if err != nil {
			return preparedRouteBody{}, err
		}
	}
	return preparedRouteBody{
		body:          io.NopCloser(bytes.NewReader(body)),
		length:        int64(len(body)),
		model:         model,
		h3Seconds:     seconds,
		hash:          hashRequestBody(body),
		fullyBuffered: true,
	}, nil
}

type recordingReader struct {
	source io.Reader
	buffer bytes.Buffer
	limit  int
}

func (r *recordingReader) Read(p []byte) (int, error) {
	n, err := r.source.Read(p)
	if n > 0 {
		if r.buffer.Len()+n > r.limit {
			return n, fmt.Errorf("multipart model field must precede file fields")
		}
		_, _ = r.buffer.Write(p[:n])
	}
	return n, err
}

func inspectMultipartBody(r *http.Request, contentType string) (preparedRouteBody, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil || params["boundary"] == "" {
		return preparedRouteBody{}, fmt.Errorf("multipart boundary is invalid")
	}
	recorder := &recordingReader{source: r.Body, limit: 1 << 20}
	model, modelErr := readMultipartModel(multipart.NewReader(recorder, params["boundary"]))
	if modelErr != nil {
		return preparedRouteBody{}, modelErr
	}
	if model == "" {
		return preparedRouteBody{}, fmt.Errorf("multipart model field is required before file fields")
	}
	return preparedRouteBody{
		body:   &replayReadCloser{reader: io.MultiReader(bytes.NewReader(recorder.buffer.Bytes()), r.Body), closeFn: r.Body.Close},
		length: r.ContentLength,
		model:  model,
	}, nil
}

func (s *Server) spoolMultipartBody(r *http.Request, contentType string) (preparedRouteBody, error) {
	temporary, err := os.CreateTemp("", "cheapbuddy-relay-body-*")
	if err != nil {
		return preparedRouteBody{}, fmt.Errorf("request body spool unavailable")
	}
	temporaryPath := temporary.Name()
	removeTemporary := func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryPath)
	}
	written, copyErr := io.Copy(temporary, io.LimitReader(r.Body, s.Config.MaxBodyBytes+1))
	if copyErr != nil || written > s.Config.MaxBodyBytes {
		removeTemporary()
		return preparedRouteBody{}, fmt.Errorf("request body too large")
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		removeTemporary()
		return preparedRouteBody{}, fmt.Errorf("request body spool unavailable")
	}
	model, modelErr := readMultipartModelFromReader(temporary, contentType)
	if modelErr != nil {
		removeTemporary()
		return preparedRouteBody{}, modelErr
	}
	if model == "" {
		removeTemporary()
		return preparedRouteBody{}, fmt.Errorf("multipart model field is required")
	}
	seconds := 0
	if model == "MiniMax-H3" {
		if _, err := temporary.Seek(0, io.SeekStart); err != nil {
			removeTemporary()
			return preparedRouteBody{}, fmt.Errorf("request body spool unavailable")
		}
		seconds, err = h3MultipartSeconds(temporary, contentType)
		if err != nil {
			removeTemporary()
			return preparedRouteBody{}, err
		}
	}
	requestHash, hashErr := canonicalMultipartHash(temporary, contentType, s.Config.MaxBodyBytes)
	if hashErr != nil {
		removeTemporary()
		return preparedRouteBody{}, hashErr
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		removeTemporary()
		return preparedRouteBody{}, fmt.Errorf("request body spool unavailable")
	}
	return preparedRouteBody{
		body:          &temporaryBody{File: temporary, path: temporaryPath},
		length:        written,
		model:         model,
		h3Seconds:     seconds,
		hash:          requestHash,
		fullyBuffered: true,
	}, nil
}

type multipartDigest struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Filename string `json:"filename,omitempty"`
	MIME     string `json:"mime,omitempty"`
	Value    string `json:"value,omitempty"`
	SHA256   string `json:"sha256,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

func canonicalMultipartHash(file *os.File, contentType string, maxBytes int64) (string, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", fmt.Errorf("request body spool unavailable")
	}
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil || params["boundary"] == "" {
		return "", fmt.Errorf("multipart boundary is invalid")
	}
	reader := multipart.NewReader(file, params["boundary"])
	digests := make([]multipartDigest, 0, 4)
	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			return "", fmt.Errorf("multipart body is invalid")
		}
		digest := multipartDigest{Kind: "field", Name: part.FormName()}
		if part.FileName() != "" {
			hasher := sha256.New()
			size, copyErr := io.Copy(hasher, io.LimitReader(part, maxBytes+1))
			if copyErr != nil || size > maxBytes {
				return "", fmt.Errorf("multipart file is too large")
			}
			digest.Kind = "file"
			digest.Filename = part.FileName()
			digest.MIME = part.Header.Get("Content-Type")
			digest.SHA256 = hex.EncodeToString(hasher.Sum(nil))
			digest.Size = size
		} else {
			value, readErr := io.ReadAll(io.LimitReader(part, 1<<20+1))
			if readErr != nil || int64(len(value)) > 1<<20 {
				return "", fmt.Errorf("multipart field is too large")
			}
			digest.Value = string(value)
		}
		digests = append(digests, digest)
	}
	sort.Slice(digests, func(i, j int) bool {
		left, _ := json.Marshal(digests[i])
		right, _ := json.Marshal(digests[j])
		return string(left) < string(right)
	})
	canonical, err := json.Marshal(digests)
	if err != nil {
		return "", fmt.Errorf("multipart hash unavailable")
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}

func readMultipartModelFromReader(source io.Reader, contentType string) (string, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil || params["boundary"] == "" {
		return "", fmt.Errorf("multipart boundary is invalid")
	}
	return readMultipartModel(multipart.NewReader(source, params["boundary"]))
}

func readMultipartModel(reader *multipart.Reader) (string, error) {
	for {
		part, nextErr := reader.NextPart()
		if nextErr == io.EOF {
			return "", nil
		}
		if nextErr != nil {
			return "", fmt.Errorf("multipart body is invalid")
		}
		if part.FileName() != "" {
			return "", fmt.Errorf("multipart model field must precede file fields")
		}
		if part.FormName() == "model" {
			value, readErr := io.ReadAll(io.LimitReader(part, 256))
			if readErr != nil || len(value) == 256 {
				return "", fmt.Errorf("multipart model field is invalid")
			}
			return strings.TrimSpace(string(value)), nil
		}
		if _, copyErr := io.Copy(io.Discard, io.LimitReader(part, 64<<10)); copyErr != nil {
			return "", fmt.Errorf("multipart body is invalid")
		}
	}
}

type replayReadCloser struct {
	reader  io.Reader
	closeFn func() error
}

func (r *replayReadCloser) Read(p []byte) (int, error) { return r.reader.Read(p) }
func (r *replayReadCloser) Close() error               { return r.closeFn() }

type temporaryBody struct {
	*os.File
	path      string
	closeErr  error
	closeOnce sync.Once
}

func (r *temporaryBody) Close() error {
	r.closeOnce.Do(func() {
		r.closeErr = r.File.Close()
		if removeErr := os.Remove(r.path); r.closeErr == nil {
			r.closeErr = removeErr
		}
	})
	return r.closeErr
}

func extractModel(body []byte, contentType string) string {
	if len(body) == 0 {
		return ""
	}
	if strings.Contains(strings.ToLower(contentType), "json") {
		var payload struct {
			Model string `json:"model"`
		}
		if json.Unmarshal(body, &payload) == nil {
			return strings.TrimSpace(payload.Model)
		}
		return ""
	}
	match := regexp.MustCompile(`(?is)name="model"[^\r\n]*\r?\n\r?\n([^\r\n]+)`).FindSubmatch(body)
	if len(match) == 2 {
		return strings.TrimSpace(string(match[1]))
	}
	return ""
}

func nativeTaskID(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"id", "task_id", "request_id"} {
			if id, ok := typed[key]; ok && fmt.Sprint(id) != "" {
				return fmt.Sprint(id)
			}
		}
		for _, key := range []string{"data", "result", "response"} {
			if id := nativeTaskID(typed[key]); id != "" {
				return id
			}
		}
	}
	return ""
}

func providerTaskID(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"task_id", "provider_task_id"} {
			if id, ok := typed[key]; ok && strings.TrimSpace(fmt.Sprint(id)) != "" {
				return strings.TrimSpace(fmt.Sprint(id))
			}
		}
		for _, key := range []string{"data", "result", "task", "response", "metadata"} {
			if id := providerTaskID(typed[key]); id != "" {
				return id
			}
		}
	}
	return ""
}

func newAPIRequestID(response *http.Response) string {
	if response == nil {
		return ""
	}
	return strings.TrimSpace(response.Header.Get("X-Oneapi-Request-Id"))
}

func mediaIdempotencyKey(headers http.Header) string {
	return validRequestID(headers.Get("Idempotency-Key"))
}

func hashRequestBody(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var value any
	if json.Unmarshal(body, &value) == nil {
		if canonical, err := json.Marshal(value); err == nil {
			body = canonical
		}
	}
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func settlementAmount(bill upstream.Bill, multiplier float64) (int64, bool) {
	switch strings.ToLower(bill.Status) {
	case "failed", "failure", "cancelled", "canceled", "rejected", "error":
		return 0, true
	}
	if bill.FinalQuota <= 0 {
		return 0, true
	}
	return int64(math.Ceil(float64(bill.FinalQuota) * multiplier)), false
}

func requestHashFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestHashKey{}).(string)
	return value
}

func stripHopHeaders(headers http.Header) {
	for _, key := range []string{"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "TE", "Trailer", "Transfer-Encoding", "Upgrade", "Content-Length"} {
		headers.Del(key)
	}
}

func bearer(value string) string {
	if strings.HasPrefix(value, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	}
	return ""
}
func requestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey{}).(string)
	return value
}
func validRequestID(value string) string {
	if len(value) > 0 && len(value) <= 128 && regexp.MustCompile(`^[A-Za-z0-9._:-]+$`).MatchString(value) {
		return value
	}
	return ""
}
func newRequestID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("relay-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(value)
}
func maxDuration(left, right time.Duration) time.Duration {
	if left > right {
		return left
	}
	return right
}
func sortedModels(models map[string]struct{}) []string {
	result := make([]string, 0, len(models))
	for model := range models {
		result = append(result, model)
	}
	for i := range result {
		for j := i + 1; j < len(result); j++ {
			if result[j] < result[i] {
				result[i], result[j] = result[j], result[i]
			}
		}
	}
	return result
}

func mediaBillingMode(cfg config.Config, model string) string {
	if mode := cfg.MediaBillingModeByModel[model]; mode != "" {
		return mode
	}
	return "paid"
}

func mediaModelEnabled(cfg config.Config, model string) bool {
	_, verified := cfg.VerifiedMediaModels[model]
	return verified && mediaBillingMode(cfg, model) != "disabled"
}

func mediaModelVisible(cfg config.Config, model string) bool {
	if !mediaModelEnabled(cfg, model) {
		return false
	}
	if cfg.VisibleMediaModels == nil {
		return true
	}
	_, visible := cfg.VisibleMediaModels[model]
	return visible
}

func mediaModelConfigured(cfg config.Config, model string) bool {
	if !mediaModelEnabled(cfg, model) {
		return false
	}
	_, priced := cfg.MediaMultiplierByModel[model]
	_, reserved := cfg.ReservationQuotaByModel[model]
	return priced && reserved
}

func hiddenMediaDetailItem(cfg config.Config, model string, catalog map[string]map[string]any) (map[string]any, bool) {
	if !mediaModelConfigured(cfg, model) || mediaModelVisible(cfg, model) {
		return nil, false
	}
	source, ok := catalog[model]
	if !ok {
		return nil, false
	}
	item := applyConfiguredMediaCapabilities(normalizeModelMetadata(source), cfg.MediaCapabilitiesByModel)
	if item["object"] == nil {
		item["object"] = "model"
	}
	if item["owned_by"] == nil {
		item["owned_by"] = "cheapbuddy"
	}
	return item, true
}

func constantTimeEqual(left, right string) bool {
	if left == "" || right == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}
func (s *Server) log(event, requestID string, attributes ...any) {
	values := append([]any{"event", event, "request_id", requestID}, attributes...)
	s.Logger.Warn("relay_event", values...)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, kind, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"type": kind, "message": message}})
}
func copyResponse(w http.ResponseWriter, response *http.Response) {
	for key, values := range response.Header {
		if key != "Set-Cookie" {
			w.Header()[key] = append([]string(nil), values...)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}
