package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultIdentityTTL = 180 * time.Second
	DefaultMappingTTL  = 30 * time.Minute
)

type Config struct {
	Port                     string
	PublicURL                string
	DatabaseURL              string
	RedisURL                 string
	Sub2APIURL               string
	NewAPIURL                string
	RelayServiceToken        string
	NewAPIAdminToken         string
	TokenEncryptionKey       string
	InternalAdminToken       string
	MediaEnabled             bool
	VerifiedMediaModels      map[string]struct{}
	VisibleMediaModels       map[string]struct{}
	MediaCapabilitiesByModel map[string][]string
	ReservationQuotaByModel  map[string]int64
	MediaMultiplierByModel   map[string]float64
	MediaBillingModeByModel  map[string]string
	QuotaPerUSD              float64
	TextPaths                map[string]struct{}
	MediaPaths               map[string]struct{}
	AllowedCORSOrigins       map[string]struct{}
	IdentityTTL              time.Duration
	MappingTTL               time.Duration
	Sub2APITimeout           time.Duration
	NewAPITimeout            time.Duration
	StreamIdleTimeout        time.Duration
	MaxBodyBytes             int64
	RateWindow               time.Duration
	TextRateLimit            int64
	MediaSubmissionRateLimit int64
	MediaPollRateLimit       int64
	AuthRateLimit            int64
	ReconciliationInterval   time.Duration
	ReconciliationBatchSize  int
	NewAPIUserPath           string
	NewAPILoginPath          string
	NewAPILogPath            string
}

func Load(getenv func(string) string) (Config, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	for _, name := range []string{
		"REDIS_URL",
		"SUB2API_INTERNAL_URL",
		"SUB2API_RELAY_SERVICE_TOKEN",
		"RELAY_INTERNAL_ADMIN_TOKEN",
	} {
		if strings.TrimSpace(getenv(name)) == "" {
			return Config{}, fmt.Errorf("%s is required", name)
		}
	}

	verifiedModels := csvSet(getenv("RELAY_VERIFIED_MODELS"))
	visibleModels, err := visibleMediaModels(getenv("RELAY_VISIBLE_MEDIA_MODELS"), verifiedModels)
	if err != nil {
		return Config{}, err
	}
	mediaEnabled := len(verifiedModels) > 0
	mediaCapabilities, err := mediaCapabilitiesMap(getenv("RELAY_MEDIA_CAPABILITIES_BY_MODEL"), verifiedModels)
	if err != nil {
		return Config{}, err
	}
	reservations := map[string]int64{}
	multipliers := map[string]float64{}
	billingModes := map[string]string{}
	if mediaEnabled {
		for _, name := range []string{"DATABASE_URL", "NEWAPI_INTERNAL_URL", "NEWAPI_ADMIN_TOKEN", "RELAY_TOKEN_ENCRYPTION_KEY"} {
			if strings.TrimSpace(getenv(name)) == "" {
				return Config{}, fmt.Errorf("%s is required when media is enabled", name)
			}
		}
		var err error
		reservations, err = int64Map(getenv("RELAY_RESERVATION_QUOTA_BY_MODEL"), "RELAY_RESERVATION_QUOTA_BY_MODEL")
		if err != nil {
			return Config{}, err
		}
		multipliers, err = floatMap(getenv("RELAY_MEDIA_MULTIPLIER_BY_MODEL"), "RELAY_MEDIA_MULTIPLIER_BY_MODEL")
		if err != nil {
			return Config{}, err
		}
		for model := range verifiedModels {
			if _, ok := reservations[model]; !ok {
				return Config{}, fmt.Errorf("RELAY_RESERVATION_QUOTA_BY_MODEL.%s is required", model)
			}
			if _, ok := multipliers[model]; !ok {
				return Config{}, fmt.Errorf("RELAY_MEDIA_MULTIPLIER_BY_MODEL.%s is required", model)
			}
		}
		billingModes, err = billingModeMap(getenv("RELAY_MEDIA_BILLING_MODE_BY_MODEL"), verifiedModels)
		if err != nil {
			return Config{}, err
		}
	}

	c := Config{
		Port:                     fallback(getenv("PORT"), "8080"),
		PublicURL:                trimURL(strings.TrimSpace(getenv("RELAY_PUBLIC_URL"))),
		DatabaseURL:              strings.TrimSpace(getenv("DATABASE_URL")),
		RedisURL:                 required(getenv, "REDIS_URL"),
		Sub2APIURL:               trimURL(required(getenv, "SUB2API_INTERNAL_URL")),
		NewAPIURL:                trimURL(strings.TrimSpace(getenv("NEWAPI_INTERNAL_URL"))),
		RelayServiceToken:        required(getenv, "SUB2API_RELAY_SERVICE_TOKEN"),
		NewAPIAdminToken:         strings.TrimSpace(getenv("NEWAPI_ADMIN_TOKEN")),
		TokenEncryptionKey:       strings.TrimSpace(getenv("RELAY_TOKEN_ENCRYPTION_KEY")),
		InternalAdminToken:       required(getenv, "RELAY_INTERNAL_ADMIN_TOKEN"),
		MediaEnabled:             mediaEnabled,
		VerifiedMediaModels:      verifiedModels,
		VisibleMediaModels:       visibleModels,
		MediaCapabilitiesByModel: mediaCapabilities,
		ReservationQuotaByModel:  reservations,
		MediaMultiplierByModel:   multipliers,
		MediaBillingModeByModel:  billingModes,
		QuotaPerUSD:              floatValue(getenv("SUB2API_RELAY_QUOTA_PER_USD"), 500000),
		TextPaths:                csvSetDefault(getenv("RELAY_TEXT_PATHS"), []string{"/v1/chat/completions", "/v1/responses", "/v1/messages"}),
		MediaPaths:               csvSetDefault(getenv("RELAY_MEDIA_PATHS"), []string{"/v1/images/generations", "/v1/images/edits", "/v1/images/variations", "/v1/images/tasks", "/v1/video/generations", "/v1/videos", "/v1/audio/speech", "/v1/audio/transcriptions", "/v1/audio/translations", "/suno/submit/music", "/suno/submit/lyrics", "/suno/fetch"}),
		AllowedCORSOrigins:       csvSet(getenv("RELAY_CORS_ORIGINS")),
		IdentityTTL:              duration(getenv("RELAY_IDENTITY_CACHE_TTL"), DefaultIdentityTTL),
		MappingTTL:               duration(getenv("RELAY_MAPPING_CACHE_TTL"), DefaultMappingTTL),
		Sub2APITimeout:           duration(getenv("SUB2API_TIMEOUT"), 10*time.Second),
		NewAPITimeout:            duration(getenv("NEWAPI_TIMEOUT"), 30*time.Second),
		StreamIdleTimeout:        duration(getenv("RELAY_STREAM_IDLE_TIMEOUT"), 5*time.Minute),
		MaxBodyBytes:             int64Value(getenv("RELAY_MAX_BODY_BYTES"), 64<<20),
		RateWindow:               duration(getenv("RELAY_RATE_WINDOW"), time.Minute),
		TextRateLimit:            int64Value(getenv("RELAY_TEXT_RATE_LIMIT"), 600),
		MediaSubmissionRateLimit: int64Value(getenv("RELAY_MEDIA_SUBMISSION_RATE_LIMIT"), 30),
		MediaPollRateLimit:       int64Value(getenv("RELAY_MEDIA_POLL_RATE_LIMIT"), 240),
		AuthRateLimit:            int64Value(getenv("RELAY_AUTH_RATE_LIMIT"), 120),
		ReconciliationInterval:   duration(getenv("RECONCILIATION_INTERVAL"), time.Minute),
		ReconciliationBatchSize:  intValue(getenv("RECONCILIATION_BATCH_SIZE"), 100),
		NewAPIUserPath:           fallback(getenv("NEWAPI_USER_PATH"), "/api/user/"),
		NewAPILoginPath:          fallback(getenv("NEWAPI_LOGIN_PATH"), "/api/user/login"),
		NewAPILogPath:            "/api/log/",
	}
	return c, nil
}

func visibleMediaModels(value string, verified map[string]struct{}) (map[string]struct{}, error) {
	if strings.TrimSpace(value) == "" {
		visible := make(map[string]struct{}, len(verified))
		for model := range verified {
			visible[model] = struct{}{}
		}
		return visible, nil
	}
	visible := csvSet(value)
	for model := range visible {
		if _, ok := verified[model]; !ok {
			return nil, fmt.Errorf("RELAY_VISIBLE_MEDIA_MODELS.%s must be listed in RELAY_VERIFIED_MODELS", model)
		}
	}
	return visible, nil
}

func mediaCapabilitiesMap(value string, verifiedModels map[string]struct{}) (map[string][]string, error) {
	result := map[string][]string{}
	if strings.TrimSpace(value) == "" {
		return result, nil
	}
	if err := json.Unmarshal([]byte(value), &result); err != nil || len(result) == 0 {
		return nil, fmt.Errorf("RELAY_MEDIA_CAPABILITIES_BY_MODEL must be a non-empty JSON object")
	}
	allowed := map[string]struct{}{
		"text_to_image": {}, "image_edit": {}, "variation": {},
		"text_to_video": {}, "image_to_video": {}, "reference_to_video": {},
	}
	for model, capabilities := range result {
		if _, verified := verifiedModels[model]; !verified {
			return nil, fmt.Errorf("RELAY_MEDIA_CAPABILITIES_BY_MODEL.%s must be listed in RELAY_VERIFIED_MODELS", model)
		}
		if len(capabilities) == 0 {
			return nil, fmt.Errorf("RELAY_MEDIA_CAPABILITIES_BY_MODEL.%s must contain at least one capability", model)
		}
		seen := map[string]struct{}{}
		for index, capability := range capabilities {
			capability = strings.ToLower(strings.TrimSpace(capability))
			if _, ok := allowed[capability]; !ok {
				return nil, fmt.Errorf("RELAY_MEDIA_CAPABILITIES_BY_MODEL.%s contains unsupported capability %q", model, capability)
			}
			if _, duplicate := seen[capability]; duplicate {
				return nil, fmt.Errorf("RELAY_MEDIA_CAPABILITIES_BY_MODEL.%s contains duplicate capability %q", model, capability)
			}
			seen[capability] = struct{}{}
			result[model][index] = capability
		}
	}
	return result, nil
}

func billingModeMap(value string, models map[string]struct{}) (map[string]string, error) {
	result := map[string]string{}
	if strings.TrimSpace(value) == "" {
		for model := range models {
			if model == "MiniMax-H3" {
				return nil, fmt.Errorf("RELAY_MEDIA_BILLING_MODE_BY_MODEL.MiniMax-H3 is required")
			}
			result[model] = "paid"
		}
		return result, nil
	}
	if err := json.Unmarshal([]byte(value), &result); err != nil || len(result) == 0 {
		return nil, fmt.Errorf("RELAY_MEDIA_BILLING_MODE_BY_MODEL must be a non-empty JSON object")
	}
	for model := range models {
		mode, ok := result[model]
		if !ok {
			if model == "MiniMax-H3" {
				return nil, fmt.Errorf("RELAY_MEDIA_BILLING_MODE_BY_MODEL.%s is required", model)
			}
			result[model] = "paid"
			continue
		}
		if mode != "paid" && mode != "free" && mode != "disabled" {
			return nil, fmt.Errorf("RELAY_MEDIA_BILLING_MODE_BY_MODEL.%s must be paid, free, or disabled", model)
		}
	}
	return result, nil
}

func required(getenv func(string) string, name string) string {
	return strings.TrimSpace(getenv(name))
}

func csvSet(value string) map[string]struct{} {
	result := map[string]struct{}{}
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			result[item] = struct{}{}
		}
	}
	return result
}

func csvSetDefault(value string, fallbackValues []string) map[string]struct{} {
	if values := csvSet(value); len(values) > 0 {
		return values
	}
	return csvSet(strings.Join(fallbackValues, ","))
}

func int64Map(value, name string) (map[string]int64, error) {
	decoded := map[string]int64{}
	if err := json.Unmarshal([]byte(value), &decoded); err != nil || len(decoded) == 0 {
		return nil, fmt.Errorf("%s must be a non-empty JSON object", name)
	}
	for model, amount := range decoded {
		if strings.TrimSpace(model) == "" || amount < 0 {
			return nil, fmt.Errorf("%s contains an invalid amount", name)
		}
	}
	return decoded, nil
}

func floatMap(value, name string) (map[string]float64, error) {
	decoded := map[string]float64{}
	if err := json.Unmarshal([]byte(value), &decoded); err != nil || len(decoded) == 0 {
		return nil, fmt.Errorf("%s must be a non-empty JSON object", name)
	}
	for model, multiplier := range decoded {
		if strings.TrimSpace(model) == "" || multiplier <= 0 {
			return nil, fmt.Errorf("%s contains an invalid multiplier", name)
		}
	}
	return decoded, nil
}

func duration(value string, fallbackValue time.Duration) time.Duration {
	if strings.TrimSpace(value) == "" {
		return fallbackValue
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return fallbackValue
	}
	return parsed
}

func int64Value(value string, fallbackValue int64) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed < 0 {
		return fallbackValue
	}
	return parsed
}

func intValue(value string, fallbackValue int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallbackValue
	}
	return parsed
}

func floatValue(value string, fallbackValue float64) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || parsed <= 0 {
		return fallbackValue
	}
	return parsed
}

func fallback(value, fallbackValue string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallbackValue
}

func trimURL(value string) string { return strings.TrimRight(value, "/") }
