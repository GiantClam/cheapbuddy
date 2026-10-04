package config

import (
	"strings"
	"testing"
	"time"
)

func testEnv(overrides map[string]string) func(string) string {
	values := map[string]string{
		"DATABASE_URL":                     "postgres://relay:test@localhost/relay",
		"REDIS_URL":                        "redis://localhost:6379/0",
		"SUB2API_INTERNAL_URL":             "http://sub2api.railway.internal",
		"NEWAPI_INTERNAL_URL":              "http://newapi.railway.internal",
		"SUB2API_RELAY_SERVICE_TOKEN":      "relay-token",
		"NEWAPI_ADMIN_TOKEN":               "newapi-token",
		"RELAY_TOKEN_ENCRYPTION_KEY":       "encryption-key",
		"RELAY_INTERNAL_ADMIN_TOKEN":       "internal-token",
		"RELAY_VERIFIED_MODELS":            "gpt-image-2,seedance",
		"RELAY_RESERVATION_QUOTA_BY_MODEL": `{"gpt-image-2":100,"seedance":1000}`,
		"RELAY_MEDIA_MULTIPLIER_BY_MODEL":  `{"gpt-image-2":1.2,"seedance":2}`,
	}
	for key, value := range overrides {
		values[key] = value
	}
	return func(key string) string { return values[key] }
}

func TestLoadUsesConfirmedCacheTTLs(t *testing.T) {
	config, err := Load(testEnv(map[string]string{
		"RELAY_MEDIA_CAPABILITIES_BY_MODEL": `{"seedance":["text_to_video"]}`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if config.IdentityTTL != 180*time.Second || config.MappingTTL != 30*time.Minute {
		t.Fatalf("unexpected cache TTLs: %s %s", config.IdentityTTL, config.MappingTTL)
	}
	if config.MediaMultiplierByModel["seedance"] != 2 {
		t.Fatalf("media multiplier was not loaded")
	}
	if got := config.MediaCapabilitiesByModel["seedance"]; len(got) != 1 || got[0] != "text_to_video" {
		t.Fatalf("media capabilities were not loaded: %#v", got)
	}
	if config.MediaBillingModeByModel["seedance"] != "paid" {
		t.Fatalf("default media billing mode was not paid")
	}
	if config.NewAPILogPath != "/api/log/" {
		t.Fatalf("NewAPI log path = %q", config.NewAPILogPath)
	}
	if config.PublicURL != "" {
		t.Fatalf("public URL should default to empty for request-derived URLs: %q", config.PublicURL)
	}
}

func TestLoadReadsPublicURL(t *testing.T) {
	config, err := Load(testEnv(map[string]string{"RELAY_PUBLIC_URL": "https://api.cheapbuddy.cc/"}))
	if err != nil {
		t.Fatal(err)
	}
	if config.PublicURL != "https://api.cheapbuddy.cc" {
		t.Fatalf("public URL = %q", config.PublicURL)
	}
}

func TestLoadValidatesMediaCapabilities(t *testing.T) {
	_, err := Load(testEnv(map[string]string{
		"RELAY_MEDIA_CAPABILITIES_BY_MODEL": `{"unknown-model":["text_to_video"]}`,
	}))
	if err == nil || !strings.Contains(err.Error(), "RELAY_VERIFIED_MODELS") {
		t.Fatalf("expected unverified model rejection, got %v", err)
	}
	_, err = Load(testEnv(map[string]string{
		"RELAY_MEDIA_CAPABILITIES_BY_MODEL": `{"seedance":["chat"]}`,
	}))
	if err == nil || !strings.Contains(err.Error(), "unsupported capability") {
		t.Fatalf("expected unsupported capability rejection, got %v", err)
	}
}

func TestLoadSeparatesVisibleAndCallableMediaModels(t *testing.T) {
	defaultConfig, err := Load(testEnv(nil))
	if err != nil {
		t.Fatal(err)
	}
	if len(defaultConfig.VisibleMediaModels) != len(defaultConfig.VerifiedMediaModels) {
		t.Fatal("visible media should default to all verified media")
	}
	configured, err := Load(testEnv(map[string]string{"RELAY_VISIBLE_MEDIA_MODELS": "seedance"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(configured.VisibleMediaModels) != 1 || len(configured.VerifiedMediaModels) != 2 {
		t.Fatal("hidden verified media must remain callable")
	}
	if _, err := Load(testEnv(map[string]string{"RELAY_VISIBLE_MEDIA_MODELS": "unknown-model"})); err == nil {
		t.Fatal("visible media must be a subset of verified media")
	}
}

func TestLoadValidatesMediaBillingModes(t *testing.T) {
	config, err := Load(testEnv(map[string]string{"RELAY_MEDIA_BILLING_MODE_BY_MODEL": `{"gpt-image-2":"disabled","seedance":"paid"}`}))
	if err != nil {
		t.Fatal(err)
	}
	if config.MediaBillingModeByModel["gpt-image-2"] != "disabled" {
		t.Fatalf("billing mode was not loaded")
	}
	partial, err := Load(testEnv(map[string]string{"RELAY_MEDIA_BILLING_MODE_BY_MODEL": `{"gpt-image-2":"paid"}`}))
	if err != nil || partial.MediaBillingModeByModel["seedance"] != "paid" {
		t.Fatalf("existing models should retain the paid default, got config=%v err=%v", partial.MediaBillingModeByModel, err)
	}
	h3Env := testEnv(map[string]string{
		"RELAY_VERIFIED_MODELS":             "MiniMax-H3",
		"RELAY_RESERVATION_QUOTA_BY_MODEL":  `{"MiniMax-H3":1000}`,
		"RELAY_MEDIA_MULTIPLIER_BY_MODEL":   `{"MiniMax-H3":1.5}`,
		"RELAY_MEDIA_BILLING_MODE_BY_MODEL": "",
	})
	if _, err = billingModeMap(h3Env("RELAY_MEDIA_BILLING_MODE_BY_MODEL"), map[string]struct{}{"MiniMax-H3": {}}); err == nil {
		t.Fatal("direct billing mode validation accepted missing MiniMax-H3 mode")
	}
	_, err = Load(h3Env)
	if err == nil || !strings.Contains(err.Error(), "MiniMax-H3") {
		t.Fatalf("expected MiniMax-H3 billing mode requirement, got %v", err)
	}
}

func TestLoadRejectsUnpricedVerifiedModel(t *testing.T) {
	_, err := Load(testEnv(map[string]string{"RELAY_MEDIA_MULTIPLIER_BY_MODEL": `{"gpt-image-2":1}`}))
	if err == nil || !strings.Contains(err.Error(), "seedance") {
		t.Fatalf("expected missing model error, got %v", err)
	}
}

func TestLoadAllowsTextOnlyRelay(t *testing.T) {
	config, err := Load(testEnv(map[string]string{
		"DATABASE_URL":                     "",
		"NEWAPI_INTERNAL_URL":              "",
		"NEWAPI_ADMIN_TOKEN":               "",
		"RELAY_TOKEN_ENCRYPTION_KEY":       "",
		"RELAY_VERIFIED_MODELS":            "",
		"RELAY_RESERVATION_QUOTA_BY_MODEL": "",
		"RELAY_MEDIA_MULTIPLIER_BY_MODEL":  "",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if config.MediaEnabled {
		t.Fatal("text-only relay must disable media")
	}
	if len(config.VerifiedMediaModels) != 0 || len(config.ReservationQuotaByModel) != 0 || len(config.MediaMultiplierByModel) != 0 || len(config.MediaBillingModeByModel) != 0 {
		t.Fatal("text-only relay must not configure media billing")
	}
}
