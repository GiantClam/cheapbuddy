package config

import (
	"os"
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

func TestLoadReadsCatalogModelAllowlist(t *testing.T) {
	cfg, err := Load(testEnv(map[string]string{
		"RELAY_MODEL_CATALOG_ALLOWLIST": " gpt-6-astra, claude-sonnet-5, gpt-6-astra ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.CatalogModelAllowlist) != 2 {
		t.Fatalf("catalog allowlist = %#v", cfg.CatalogModelAllowlist)
	}
	if _, ok := cfg.CatalogModelAllowlist["gpt-6-astra"]; !ok {
		t.Fatal("catalog allowlist omitted OpenAI model")
	}
	if _, ok := cfg.CatalogModelAllowlist["claude-sonnet-5"]; !ok {
		t.Fatal("catalog allowlist omitted Claude model")
	}
}

func TestLoadReadsModelAliasesFromFile(t *testing.T) {
	file := t.TempDir() + "/model-aliases.json"
	if err := os.WriteFile(file, []byte(`{"deepseek/deepseek-v4.1-flash":"deepseek-flash","deepseek-flash":"deepseek-4.1-flash-1017","deepseek-v4.1-flash-1017":"deepseek-flash"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(testEnv(map[string]string{"RELAY_MODEL_ALIASES_FILE": file}))
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.ModelAliases["deepseek/deepseek-v4.1-flash"]; got != "deepseek-flash" {
		t.Fatalf("canonical DeepSeek alias = %q", got)
	}
	if got := cfg.ModelAliases["deepseek-v4.1-flash-1017"]; got != "deepseek-flash" {
		t.Fatalf("1017 DeepSeek alias = %q", got)
	}
	if got := cfg.ModelAliases["deepseek-flash"]; got != "deepseek-4.1-flash-1017" {
		t.Fatalf("internal DeepSeek route alias = %q", got)
	}
	if got := cfg.ModelAliases["deepseek-4.1-flash-1017"]; got != "" {
		t.Fatalf("public 1017 DeepSeek ID should remain unchanged, got alias %q", got)
	}
}

func TestLoadEnvironmentAliasesOverrideFile(t *testing.T) {
	file := t.TempDir() + "/model-aliases.json"
	if err := os.WriteFile(file, []byte(`{"from-file":"provider-file"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(testEnv(map[string]string{
		"RELAY_MODEL_ALIASES_FILE": file,
		"RELAY_MODEL_ALIASES":      `{"custom-deepseek":"deepseek-flash"}`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ModelAliases["custom-deepseek"] != "deepseek-flash" {
		t.Fatalf("custom alias not found: %#v", cfg.ModelAliases)
	}
	if cfg.ModelAliases["from-file"] != "" {
		t.Fatalf("file aliases should be replaced by environment aliases: %#v", cfg.ModelAliases)
	}

	// Empty object disables all aliases
	cfg, err = Load(testEnv(map[string]string{
		"RELAY_MODEL_ALIASES": `{}`,
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.ModelAliases) != 0 {
		t.Fatalf("empty config should disable all aliases, got %#v", cfg.ModelAliases)
	}

	// Validation errors
	for _, value := range []string{"not-json", `{"":"deepseek-flash"}`, `{"custom":""}`} {
		if _, err := Load(testEnv(map[string]string{"RELAY_MODEL_ALIASES": value})); err == nil || !strings.Contains(err.Error(), "model aliases") {
			t.Fatalf("expected alias validation error for %q, got %v", value, err)
		}
	}
}

func TestLoadH3TaskTimeout(t *testing.T) {
	for _, tc := range []struct {
		value   string
		want    time.Duration
		invalid bool
	}{
		{"", 30 * time.Minute, false},
		{" 45m ", 45 * time.Minute, false},
		{"0s", 0, true},
		{"-1m", 0, true},
		{"invalid", 0, true},
	} {
		t.Run(tc.value, func(t *testing.T) {
			cfg, err := Load(testEnv(map[string]string{"RELAY_H3_TASK_TIMEOUT": tc.value}))
			if tc.invalid {
				if err == nil || !strings.Contains(err.Error(), "RELAY_H3_TASK_TIMEOUT") {
					t.Fatalf("expected timeout validation error, got %v", err)
				}
				return
			}
			if err != nil || cfg.H3TaskTimeout != tc.want {
				t.Fatalf("timeout = %s, error = %v; want %s", cfg.H3TaskTimeout, err, tc.want)
			}
		})
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
