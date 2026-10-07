package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/store"
	"github.com/cheapbuddy/relay/internal/upstream"
)

func testConfig() config.Config {
	return config.Config{
		MediaEnabled:        true,
		TextPaths:           map[string]struct{}{"/v1/chat/completions": {}, "/v1/responses": {}},
		MediaPaths:          map[string]struct{}{"/v1/images/generations": {}, "/v1/videos": {}, "/v1/audio/speech": {}, "/v1/audio/transcriptions": {}},
		VerifiedMediaModels: map[string]struct{}{"gpt-image-2": {}, "MiniMax-H3": {}},
	}
}

func TestHiddenVerifiedMediaRemainsRoutable(t *testing.T) {
	cfg := testConfig()
	cfg.VisibleMediaModels = map[string]struct{}{"MiniMax-H3": {}}
	if mediaModelVisible(cfg, "gpt-image-2") {
		t.Fatal("hidden image model appeared in the catalog")
	}
	if !mediaModelEnabled(cfg, "gpt-image-2") {
		t.Fatal("hidden image model was disabled for requests")
	}
	if route := classifyRoute("/v1/images/generations", "gpt-image-2", cfg); route != routeMediaSubmission {
		t.Fatalf("hidden image route = %v", route)
	}
	if !mediaModelVisible(cfg, "MiniMax-H3") {
		t.Fatal("visible video model disappeared")
	}
}

func TestHiddenVerifiedMediaHasExplicitDetailButStaysOutOfList(t *testing.T) {
	cfg := testConfig()
	cfg.VerifiedMediaModels["grok-imagine-image-2.0"] = struct{}{}
	cfg.VisibleMediaModels = map[string]struct{}{"MiniMax-H3": {}}
	cfg.MediaMultiplierByModel = map[string]float64{"grok-imagine-image-2.0": 1}
	cfg.ReservationQuotaByModel = map[string]int64{"grok-imagine-image-2.0": 100000}
	mediaRows := map[string]map[string]any{
		"grok-imagine-image-2.0": {"id": "grok-imagine-image-2.0", "object": "model"},
	}

	item, ok := hiddenMediaDetailItem(cfg, "grok-imagine-image-2.0", mediaRows)
	if !ok || item["type"] != "image" || !hasStringValue(item["capabilities"], "text_to_image") {
		t.Fatalf("hidden model detail = %#v, %v", item, ok)
	}
	if mediaModelVisible(cfg, "grok-imagine-image-2.0") {
		t.Fatal("hidden detail made the model visible in the list")
	}
	if _, ok := hiddenMediaDetailItem(cfg, "unverified", mediaRows); ok {
		t.Fatal("unverified model detail was exposed")
	}
}

func TestMediaUsageRangeDefaultsToThirtyDays(t *testing.T) {
	now := time.Date(2026, 9, 23, 15, 4, 5, 0, time.FixedZone("CST", 8*60*60))
	start, end, err := mediaUsageRange("2026-09-01", "2026-09-23", now)
	if err != nil {
		t.Fatal(err)
	}
	if got := start.Format(time.RFC3339); got != "2026-09-01T00:00:00Z" {
		t.Fatalf("start = %s", got)
	}
	if got := end.Format(time.RFC3339); got != "2026-09-24T00:00:00Z" {
		t.Fatalf("end = %s", got)
	}
	if _, _, err := mediaUsageRange("2026-08-01", "2026-09-23", now); err == nil {
		t.Fatal("expected a range longer than 31 days to be rejected")
	}
}

func TestAudioRoutesAreMediaSubmissions(t *testing.T) {
	cfg := testConfig()
	for _, pathName := range []string{"/v1/audio/speech", "/v1/audio/transcriptions"} {
		if got := classifyRoute(pathName, "audio-model", cfg); got != routeMediaSubmission {
			t.Fatalf("%s route = %v", pathName, got)
		}
		if !isMediaSubmission(pathName) || !isAllowedPath(pathName, cfg) {
			t.Fatalf("%s was not treated as an allowed media submission", pathName)
		}
	}
}

func TestRouteClassificationUsesPathThenModel(t *testing.T) {
	cfg := testConfig()
	if got := classifyRoute("/v1/images/generations", "gpt-image-2", cfg); got != routeMediaSubmission {
		t.Fatalf("image route = %v", got)
	}
	if got := classifyRoute("/v1/chat/completions", "gpt-image-2", cfg); got != routeMediaSubmission {
		t.Fatalf("media model route = %v", got)
	}
	if got := classifyRoute("/v1/chat/completions", "gpt-5", cfg); got != routeText {
		t.Fatalf("text model route = %v", got)
	}
	if got := classifyRoute("/v1/responses", "MiniMax-H3", cfg); got != routeMediaSubmission {
		t.Fatalf("MiniMax-H3 Responses route = %v", got)
	}
	if got := classifyRoute("/v1/responses", "gpt-5", cfg); got != routeText {
		t.Fatalf("text Responses route = %v", got)
	}
	cfg.MediaBillingModeByModel = map[string]string{"MiniMax-H3": "disabled"}
	if got := classifyRoute("/v1/responses", "MiniMax-H3", cfg); got != routeNone {
		t.Fatalf("disabled MiniMax-H3 route = %v", got)
	}
	if got := classifyRoute("/admin/users", "", cfg); got != routeNone {
		t.Fatalf("admin route = %v", got)
	}
}

func TestSelectModelPricing(t *testing.T) {
	payload := map[string]any{
		"data": []any{
			map[string]any{"model_name": "MiniMax-H3", "model_price": 0.1},
			map[string]any{"model_name": "gpt-image-2", "model_price": 0.04},
		},
		"group_ratio": map[string]any{"default": 1.2, "premium": 2.0},
	}

	got, ok := selectModelPricing(payload, "minimax-h3")
	if !ok {
		t.Fatal("expected case-insensitive model match")
	}
	if got["model_name"] != "MiniMax-H3" || got["model_price"] != 0.1 {
		t.Fatalf("unexpected selected pricing record: %#v", got)
	}
	if _, ok := selectModelPricing(payload, "missing-model"); ok {
		t.Fatal("unexpected pricing record for unknown model")
	}
}

func TestModelCatalogMetadataIsEnrichedFromDetail(t *testing.T) {
	listItem := map[string]any{"id": "video-model", "object": "model", "owned_by": "upstream"}
	detail := map[string]any{
		"id":               "video-model",
		"type":             "video",
		"capabilities":     []any{"text_to_video", "image_to_video"},
		"parameter_schema": map[string]any{"seconds": map[string]any{"type": "integer"}},
	}

	if hasMediaModelClassification(listItem) {
		t.Fatal("an unclassified list item should require detail enrichment")
	}
	merged := mergeModelMetadata(listItem, detail)
	if merged["id"] != "video-model" || merged["owned_by"] != "upstream" {
		t.Fatalf("base model fields were not preserved: %#v", merged)
	}
	if merged["type"] != "video" || merged["parameter_schema"] == nil {
		t.Fatalf("detail metadata was not copied: %#v", merged)
	}
	caps, ok := merged["capabilities"].([]any)
	if !ok || len(caps) != 2 || caps[0] != "text_to_video" || caps[1] != "image_to_video" {
		t.Fatalf("capabilities were not copied: %#v", merged["capabilities"])
	}
}

func TestMiniMaxH3ModelMetadataUsesProviderMediaFields(t *testing.T) {
	item := map[string]any{"id": "MiniMax-H3", "parameter_schema": map[string]any{
		"duration": map[string]any{"type": "integer"},
	}}
	enriched := applyKnownModelMetadata(item)
	schema, ok := enriched["parameter_schema"].(map[string]any)
	if !ok {
		t.Fatalf("missing parameter schema: %#v", enriched)
	}
	for name, kind := range map[string]string{
		"first_frame": "image", "last_frame": "image",
		"reference_video": "video", "reference_audio": "audio",
	} {
		rule, ok := schema[name].(map[string]any)
		if !ok || rule["type"] != kind {
			t.Fatalf("missing %s provider field: %#v", name, schema[name])
		}
	}
	ratio, ok := schema["ratio"].(map[string]any)
	if !ok || ratio["type"] != "string" || ratio["default"] != "16:9" {
		t.Fatalf("missing text-to-video ratio default: %#v", schema["ratio"])
	}
	if schema["duration"].(map[string]any)["type"] != "integer" {
		t.Fatal("upstream parameter was replaced")
	}
	if len(item["parameter_schema"].(map[string]any)) != 1 {
		t.Fatal("upstream parameter schema was mutated")
	}
}

func TestGrokImageMetadataAdvertisesBase64Result(t *testing.T) {
	item := map[string]any{"id": "grok-imagine-image-2.0"}
	enriched := applyKnownModelMetadata(item)
	schema, ok := enriched["parameter_schema"].(map[string]any)
	if !ok {
		t.Fatalf("missing Grok image schema: %#v", enriched)
	}
	format, ok := schema["response_format"].(map[string]any)
	if !ok || format["default"] != "b64_json" {
		t.Fatalf("missing base64 response default: %#v", schema["response_format"])
	}
	for _, capability := range []string{"text_to_image", "image_edit", "variation"} {
		if !hasStringValue(enriched["capabilities"], capability) {
			t.Fatalf("missing Grok image capability %q: %#v", capability, enriched["capabilities"])
		}
	}
	count, ok := schema["n"].(map[string]any)
	if !ok || count["type"] != "integer" || count["maximum"] != 128 {
		t.Fatalf("missing bounded image count schema: %#v", schema["n"])
	}
	if _, exists := item["parameter_schema"]; exists {
		t.Fatal("original upstream model was mutated")
	}
}

func TestSub2APITextCatalogClassifiesBareRowsWithoutOverridingMetadata(t *testing.T) {
	bare := map[string]any{"id": "chat-model", "object": "model", "owned_by": "upstream"}
	classified := classifySub2APITextModel(bare, nil, nil, nil)
	if classified["type"] != "text" || !hasStringValue(classified["capabilities"], "text_generation") {
		t.Fatalf("bare Sub2API text catalog row was not classified: %#v", classified)
	}
	if _, exists := bare["type"]; exists {
		t.Fatal("classification mutated the upstream catalog row")
	}
	genericType := map[string]any{"id": "generic-model", "type": "model"}
	classified = classifySub2APITextModel(genericType, nil, nil, nil)
	if classified["type"] != "text" || !hasStringValue(classified["capabilities"], "text_generation") {
		t.Fatalf("generic object type was mistaken for a modality: %#v", classified)
	}
	genericEndpoint := map[string]any{
		"id":                       "generic-openai-model",
		"type":                     "model",
		"supported_endpoint_types": []any{"openai"},
	}
	classified = classifySub2APITextModel(genericEndpoint, nil, nil, nil)
	if classified["type"] != "text" || !hasStringValue(classified["capabilities"], "text_generation") {
		t.Fatalf("generic Sub2API endpoint row did not default to text: %#v", classified)
	}
	if !hasStringValue(classified["supported_endpoint_types"], "openai") {
		t.Fatalf("Sub2API endpoint metadata was not preserved: %#v", classified)
	}

	explicit := map[string]any{
		"id":                       "known-model",
		"type":                     "video",
		"capabilities":             []any{"text_to_video"},
		"supported_endpoint_types": []any{"openai-video"},
	}
	got := classifySub2APITextModel(explicit, nil, nil, nil)
	if got["type"] != "video" || !hasStringValue(got["capabilities"], "text_to_video") {
		t.Fatalf("explicit upstream classification was overridden: %#v", got)
	}

	mediaRow := map[string]any{"id": "image-model", "object": "model"}
	got = classifySub2APITextModel(mediaRow, nil, nil, map[string]struct{}{"image-model": {}})
	if _, exists := got["type"]; exists || got["capabilities"] != nil {
		t.Fatalf("verified media model received a synthetic text classification: %#v", got)
	}

	newAPIMediaRow := map[string]any{"id": "catalog-image", "type": "image", "capabilities": []any{"text_to_image"}}
	mediaIDs := map[string]struct{}{newAPIMediaRow["id"].(string): {}}
	got = classifySub2APITextModel(map[string]any{"id": "catalog-image"}, mediaIDs, nil, nil)
	if _, exists := got["type"]; exists || got["capabilities"] != nil {
		t.Fatalf("NewAPI media catalog match received a synthetic text classification: %#v", got)
	}
	got = classifySub2APITextModel(map[string]any{"id": "catalog-unclassified"}, nil, map[string]struct{}{"catalog-unclassified": {}}, nil)
	if _, exists := got["type"]; exists || got["capabilities"] != nil {
		t.Fatalf("unclassified NewAPI row received a synthetic text classification: %#v", got)
	}
}

func TestKnownGrokImagineModelIsClassifiedAsImageOnly(t *testing.T) {
	model := map[string]any{
		"id":                       "grok-imagine-image-2.0",
		"type":                     "model",
		"supported_endpoint_types": []any{"openai"},
	}

	mediaCatalogModel := normalizeModelMetadata(model)
	if mediaCatalogModel["type"] != "image" || !hasStringValue(mediaCatalogModel["capabilities"], "text_to_image") {
		t.Fatalf("NewAPI catalog metadata = %#v, want image/text_to_image", mediaCatalogModel)
	}

	got := classifySub2APITextModel(model, nil, nil, nil)
	if got["type"] != "image" || !hasStringValue(got["capabilities"], "text_to_image") {
		t.Fatalf("Grok Imagine metadata = %#v, want image/text_to_image", got)
	}
	if hasTextModelClassification(got) {
		t.Fatalf("generic OpenAI endpoint was mistaken for text capability: %#v", got)
	}
	if model["type"] != "model" {
		t.Fatalf("upstream row was mutated: %#v", model)
	}
}

func TestUnconfiguredKnownMediaCatalogModelsAreFilteredOut(t *testing.T) {
	for _, id := range []string{
		"gpt-image-1.5",
		"gpt-image-2.5-flare",
		"grok-imagine-image-lite",
		"grok-video-1.5",
		"grok-image-video",
	} {
		if !isKnownMediaModelID(id) {
			t.Errorf("%q should be recognized as a media model", id)
		}
	}
	for _, id := range []string{"gpt-6-sol", "deepseek-v4-pro", "claude-opus-5"} {
		if isKnownMediaModelID(id) {
			t.Errorf("%q should not be classified as media", id)
		}
	}
}

func TestModelCatalogRefreshesIncompleteCapabilities(t *testing.T) {
	for name, item := range map[string]map[string]any{
		"generic text capability": {"capabilities": []any{"text_generation"}},
		"unknown type":            {"type": "custom", "capabilities": []any{"chat"}},
	} {
		if hasMediaModelClassification(item) {
			t.Errorf("%s should require detail enrichment", name)
		}
	}
	for name, item := range map[string]map[string]any{
		"image type":            {"type": "image"},
		"image capability":      {"capabilities": []any{"text_to_image"}},
		"video type":            {"type": "video"},
		"video capability":      {"capabilities": []any{"reference_to_video"}},
		"image edit capability": {"capabilities": []any{"image_edit"}},
	} {
		if !hasMediaModelClassification(item) {
			t.Errorf("%s should prevent unnecessary detail enrichment", name)
		}
	}
}

func TestTextCatalogClassificationSupportsDetailFallback(t *testing.T) {
	if !hasTextModelClassification(map[string]any{"type": "text", "capabilities": []any{"text_generation"}}) {
		t.Fatal("classified Sub2API text model should have a catalog-detail fallback")
	}
	if hasTextModelClassification(map[string]any{"type": "image", "capabilities": []any{"text_to_image"}}) {
		t.Fatal("media-only model should not have a text-detail fallback")
	}
}

func TestNewAPISupportedEndpointTypesExposeImageAndVideoModels(t *testing.T) {
	cases := []struct {
		name         string
		endpointType string
		modelType    string
		capability   string
	}{
		{name: "image", endpointType: "image-generation", modelType: "image", capability: "text_to_image"},
		{name: "video", endpointType: "openai-video", modelType: "video", capability: "text_to_video"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			upstreamModel := map[string]any{
				"id":                       test.name + "-model",
				"supported_endpoint_types": []any{test.endpointType},
			}
			if !hasMediaModelClassification(upstreamModel) {
				t.Fatal("explicit NewAPI endpoint type was not recognized")
			}

			got := mergeModelMetadata(map[string]any{"id": upstreamModel["id"]}, upstreamModel)
			if got["type"] != test.modelType {
				t.Fatalf("type = %#v, want %q", got["type"], test.modelType)
			}
			capabilities, ok := got["capabilities"].([]any)
			if !ok || len(capabilities) != 1 || capabilities[0] != test.capability {
				t.Fatalf("capabilities = %#v, want [%q]", got["capabilities"], test.capability)
			}
			if endpoints, ok := got["supported_endpoint_types"].([]any); !ok || len(endpoints) != 1 || endpoints[0] != test.endpointType {
				t.Fatalf("supported endpoint types were not preserved: %#v", got["supported_endpoint_types"])
			}
		})
	}
}

func TestMergeModelMetadataPreservesCapabilitiesAcrossModalities(t *testing.T) {
	textModel := map[string]any{
		"id":                       "multimodal-model",
		"type":                     "text",
		"capabilities":             []any{"text_generation"},
		"supported_endpoint_types": []any{"openai"},
	}
	videoModel := map[string]any{
		"id":                       "multimodal-model",
		"type":                     "video",
		"capabilities":             []any{"text_to_video"},
		"supported_endpoint_types": []any{"openai-video"},
	}

	merged := mergeModelMetadata(textModel, videoModel)
	if merged["type"] != "text" {
		t.Fatalf("primary text catalog type was overwritten: %#v", merged["type"])
	}
	if !hasStringValue(merged["capabilities"], "text_generation") || !hasStringValue(merged["capabilities"], "text_to_video") {
		t.Fatalf("capabilities from both catalogs should be preserved: %#v", merged["capabilities"])
	}
	if !hasStringValue(merged["supported_endpoint_types"], "openai") || !hasStringValue(merged["supported_endpoint_types"], "openai-video") {
		t.Fatalf("endpoint types from both catalogs should be preserved: %#v", merged["supported_endpoint_types"])
	}
}

func TestMediaMetadataOverridesLegacyTextTypeWithoutTextCapability(t *testing.T) {
	merged := mergeModelMetadata(
		map[string]any{"id": "video-model", "type": "text"},
		map[string]any{"id": "video-model", "type": "video", "capabilities": []any{"text_to_video"}},
	)
	if merged["type"] != "video" {
		t.Fatalf("media metadata did not replace an unsupported legacy text type: %#v", merged)
	}

	multimodal := mergeModelMetadata(
		map[string]any{"id": "multimodal-model", "type": "text", "capabilities": []any{"text_generation"}},
		map[string]any{"id": "multimodal-model", "type": "video", "capabilities": []any{"text_to_video"}},
	)
	if multimodal["type"] != "text" {
		t.Fatalf("explicit text capability was not preserved: %#v", multimodal)
	}
}

func TestConfiguredMediaCapabilitiesAddVideoSupportWithoutRemovingText(t *testing.T) {
	model := map[string]any{
		"id":           "MiniMax-H3",
		"type":         "text",
		"capabilities": []any{"text_generation"},
	}
	configured := map[string][]string{
		"MiniMax-H3": {"text_to_video", "image_to_video", "reference_to_video"},
	}

	got := applyConfiguredMediaCapabilities(model, configured)
	if got["type"] != "text" {
		t.Fatalf("configured video capability should not erase the existing primary type: %#v", got["type"])
	}
	for _, want := range []string{"text_generation", "text_to_video", "image_to_video", "reference_to_video"} {
		if !hasStringValue(got["capabilities"], want) {
			t.Errorf("missing capability %q in %#v", want, got["capabilities"])
		}
	}
}

func hasStringValue(value any, want string) bool {
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func TestFetchModelDetailReadsRelayModelExtensions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/models/video-model" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer media-token" {
			t.Errorf("authorization = %q", got)
		}
		_, _ = io.WriteString(w, `{"id":"video-model","type":"video","capabilities":["text_to_video"]}`)
	}))
	defer server.Close()

	app := &Server{Config: config.Config{Sub2APITimeout: time.Second}}
	detail, status, err := app.fetchModelDetail(httptest.NewRequest(http.MethodGet, "/v1/models", nil), server.URL, "media-token", "video-model", "metadata-request")
	if err != nil {
		t.Fatalf("fetchModelDetail returned status %d: %v", status, err)
	}
	if detail["type"] != "video" || !hasMediaModelClassification(detail) {
		t.Fatalf("detail metadata missing: %#v", detail)
	}
}

func TestFetchModelPricingUsesAccountTokenAndSelectsRateRow(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/pricing" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer user-shadow-token" {
			t.Errorf("authorization = %q", got)
		}
		if got := r.Header.Get("X-Request-ID"); got != "pricing-test-request" {
			t.Errorf("request id = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"model_name":"MiniMax-H3","model_price":0.1},{"model_name":"other","model_price":9}],"group_ratio":{"default":1.2,"private":7}}`)
	}))
	defer server.Close()

	pricing, groupRatio, err := fetchModelPricing(context.Background(), http.DefaultTransport, time.Second, server.URL, "MiniMax-H3", "user-shadow-token", "pricing-test-request")
	if err != nil {
		t.Fatal(err)
	}
	if pricing["model_name"] != "MiniMax-H3" || pricing["model_price"] != float64(0.1) {
		t.Fatalf("pricing = %#v", pricing)
	}
	if len(groupRatio) != 1 || groupRatio["default"] != float64(1.2) {
		t.Fatalf("group ratio should include only the account's default group: %#v", groupRatio)
	}
}

func TestPricingRouteRequiresMediaConfiguration(t *testing.T) {
	cfg := testConfig()
	if !isAllowedPath("/v1/pricing", cfg) {
		t.Fatal("pricing endpoint should be available when media is enabled")
	}
	cfg.MediaEnabled = false
	if isAllowedPath("/v1/pricing", cfg) {
		t.Fatal("pricing endpoint should not be available when media is disabled")
	}
}

func TestTextOnlyRelayRejectsMediaPaths(t *testing.T) {
	cfg := testConfig()
	cfg.MediaEnabled = false
	cfg.VerifiedMediaModels = map[string]struct{}{}

	if got := classifyRoute("/v1/images/generations", "gpt-image-2", cfg); got != routeNone {
		t.Fatalf("text-only image route = %v", got)
	}
	if isAllowedPath("/v1/videos", cfg) {
		t.Fatal("text-only relay must not allow media paths")
	}
	if isAllowedPath("/v1/responses/resp-1", cfg) {
		t.Fatal("text-only relay must not allow media response retrieval")
	}
	if isAllowedPath("/v1/media", cfg) || isAllowedPath("/v1/media/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", cfg) {
		t.Fatal("text-only relay must not allow temporary media storage")
	}
}

func TestTemporaryMediaStoreExpiresAndCopiesBytes(t *testing.T) {
	clock := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	media := newMediaStore(1 << 20)
	media.clock = func() time.Time { return clock }
	token, expiresAt, err := media.put([]byte("payload"), "image/png")
	if err != nil || expiresAt != clock.Add(mediaStoreTTL) {
		t.Fatalf("put = token=%q expires=%s err=%v", token, expiresAt, err)
	}
	blob, ok := media.get(token)
	if !ok || string(blob.data) != "payload" || blob.contentType != "image/png" {
		t.Fatalf("get = %#v, %v", blob, ok)
	}
	blob.data[0] = 'X'
	blob, ok = media.get(token)
	if !ok || string(blob.data) != "payload" {
		t.Fatalf("media store returned mutable backing bytes: %#v, %v", blob, ok)
	}
	clock = clock.Add(mediaStoreTTL)
	if _, ok := media.get(token); ok {
		t.Fatal("expired media remained available")
	}
}

func TestTemporaryMediaRoutesRequireMediaAndValidateToken(t *testing.T) {
	cfg := testConfig()
	if !isAllowedPath("/v1/media", cfg) {
		t.Fatal("temporary media upload route is not allowed")
	}
	if !isAllowedPath("/v1/media/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", cfg) {
		t.Fatal("temporary media download route is not allowed")
	}
	if isAllowedPath("/v1/media/not-a-token", cfg) {
		t.Fatal("invalid media token route was allowed")
	}
}

func TestExtractModelSupportsJSONAndMultipart(t *testing.T) {
	if got := extractModel([]byte(`{"model":"gpt-image-2"}`), "application/json"); got != "gpt-image-2" {
		t.Fatalf("json model = %q", got)
	}
	body := []byte("--x\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nseedance\r\n--x--")
	if got := extractModel(body, "multipart/form-data; boundary=x"); got != "seedance" {
		t.Fatalf("multipart model = %q", got)
	}
}

func TestMultipartRouteBodyReplaysAfterStreamingInspection(t *testing.T) {
	var source bytes.Buffer
	writer := multipart.NewWriter(&source)
	if err := writer.WriteField("model", "MiniMax-H3"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("first_frame", "frame.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("fake-image")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	original := append([]byte(nil), source.Bytes()...)
	request := httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(original))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.ContentLength = int64(len(original))
	server := &Server{Config: config.Config{MaxBodyBytes: 1 << 20}}

	prepared, err := server.readRouteBody(request, "/v1/videos")
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.body.Close()
	replayed, err := io.ReadAll(prepared.body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, replayed) {
		t.Fatalf("multipart body changed during inspection")
	}
	if prepared.model != "MiniMax-H3" || prepared.hash == "" || !prepared.fullyBuffered || prepared.h3Seconds != 6 {
		t.Fatalf("unexpected buffered H3 inspection result: model=%q hash=%q fully_buffered=%v seconds=%d", prepared.model, prepared.hash, prepared.fullyBuffered, prepared.h3Seconds)
	}
}

func TestMultipartIdempotentBodyUsesBoundedDiskSpool(t *testing.T) {
	body := []byte("--boundary\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nMiniMax-H3\r\n--boundary--\r\n")
	request := httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(body))
	request.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	request.Header.Set("Idempotency-Key", "media-key-1")
	request.ContentLength = int64(len(body))
	server := &Server{Config: config.Config{MaxBodyBytes: 1 << 20}}

	prepared, err := server.readRouteBody(request, "/v1/videos")
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.body.Close()
	replayed, err := io.ReadAll(prepared.body)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(body, replayed) || prepared.model != "MiniMax-H3" || prepared.hash == "" || !prepared.fullyBuffered {
		t.Fatalf("unexpected idempotent multipart result: model=%q hash=%q fully_buffered=%v body_equal=%v", prepared.model, prepared.hash, prepared.fullyBuffered, bytes.Equal(body, replayed))
	}

	bodyWithDifferentBoundary := []byte("--other-boundary\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nMiniMax-H3\r\n--other-boundary--\r\n")
	second := httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(bodyWithDifferentBoundary))
	second.Header.Set("Content-Type", "multipart/form-data; boundary=other-boundary")
	second.Header.Set("Idempotency-Key", "media-key-2")
	second.ContentLength = int64(len(bodyWithDifferentBoundary))
	secondPrepared, err := server.readRouteBody(second, "/v1/videos")
	if err != nil {
		t.Fatal(err)
	}
	defer secondPrepared.body.Close()
	if prepared.hash != secondPrepared.hash {
		t.Fatalf("multipart hash depends on random boundary: first=%q second=%q", prepared.hash, secondPrepared.hash)
	}
}

func TestNativeTaskPathAndRequestIDs(t *testing.T) {
	if !isMediaTaskPoll("/v1/videos/task-1") || taskIDFromPath("/v1/videos/task-1/content") != "task-1" {
		t.Fatal("video task path handling failed")
	}
	if !isMediaTaskPoll("/v1/responses/resp-1") || taskIDFromPath("/v1/responses/resp-1") != "resp-1" {
		t.Fatal("response task path handling failed")
	}
	artifactPath := "/v1/tasks/task-1/artifacts/video/content"
	if !isMediaTaskPoll(artifactPath) || !isTaskArtifactPath(artifactPath) || taskIDFromPath(artifactPath) != "task-1" {
		t.Fatal("task artifact path handling failed")
	}
	if validRequestID("safe.key:1") == "" || validRequestID("unsafe key") != "" {
		t.Fatal("request ID validation failed")
	}
}

func TestXRequestIDIsTraceOnly(t *testing.T) {
	if key := mediaIdempotencyKey(http.Header{"X-Request-ID": []string{"trace-only"}}); key != "" {
		t.Fatalf("X-Request-ID became an idempotency key: %q", key)
	}
	if key := mediaIdempotencyKey(http.Header{"Idempotency-Key": []string{"client-key"}}); key != "client-key" {
		t.Fatalf("Idempotency-Key = %q", key)
	}
}

func TestRequestHashCanonicalizesJSON(t *testing.T) {
	if hashRequestBody([]byte(`{"model":"MiniMax-H3","duration":8}`)) != hashRequestBody([]byte(` { "duration": 8, "model": "MiniMax-H3" } `)) {
		t.Fatal("JSON request hash was not canonicalized")
	}
}

func TestSettlementReleasesFailedOrZeroQuotaTasks(t *testing.T) {
	amount, release := settlementAmount(upstream.Bill{FinalQuota: 0}, 1.5)
	if amount != 0 || !release {
		t.Fatalf("zero quota settlement = amount %d release %v", amount, release)
	}
	amount, release = settlementAmount(upstream.Bill{FinalQuota: 10}, 1.5)
	if amount != 15 || release {
		t.Fatalf("successful settlement = amount %d release %v", amount, release)
	}
	amount, release = settlementAmount(upstream.Bill{FinalQuota: 10, Status: "cancelled"}, 1.5)
	if amount != 0 || !release {
		t.Fatalf("cancelled settlement = amount %d release %v", amount, release)
	}
}

func TestNewAPIRequestIDReadsNativeResponseHeader(t *testing.T) {
	response := &http.Response{Header: http.Header{"X-Oneapi-Request-Id": []string{" native-request-1 "}}}
	if got := newAPIRequestID(response); got != "native-request-1" {
		t.Fatalf("native request ID = %q", got)
	}
}

func TestMediaCallbackDurableContextSurvivesClientCancellation(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	cancelParent()

	callbacks := &mediaCallbacks{server: &Server{Config: config.Config{Sub2APITimeout: time.Second}}}
	stateCtx, cancelState := callbacks.durableContext(parent)
	defer cancelState()

	if err := stateCtx.Err(); err != nil {
		t.Fatalf("durable callback context inherited client cancellation: %v", err)
	}
	select {
	case <-stateCtx.Done():
		t.Fatal("durable callback context was cancelled too early")
	default:
	}
}

func TestNativeAndProviderTaskIDsAreKeptDistinct(t *testing.T) {
	payload := map[string]any{"id": "resp_1", "data": map[string]any{"task_id": "qingyan_1"}}
	if got := nativeTaskID(payload); got != "resp_1" {
		t.Fatalf("native task ID = %q", got)
	}
	if got := providerTaskID(payload); got != "qingyan_1" {
		t.Fatalf("provider task ID = %q", got)
	}
}

func TestTaskIDsFromSSELine(t *testing.T) {
	nativeID, providerID := taskIDsFromSSELine([]byte(`data: {"type":"response.created","response":{"id":"resp_1"},"task":{"task_id":"provider_1"}}`))
	if nativeID != "resp_1" || providerID != "provider_1" {
		t.Fatalf("unexpected SSE ids: native=%q provider=%q", nativeID, providerID)
	}
	nativeID, providerID = taskIDsFromSSELine([]byte(`data: {"type":"response.created","response":{"id":"resp_2","metadata":{"task_id":"task_2"}}}`))
	if nativeID != "resp_2" || providerID != "task_2" {
		t.Fatalf("metadata task IDs were not observed: native=%q provider=%q", nativeID, providerID)
	}
	if nativeID, providerID = taskIDsFromSSELine([]byte("data: [DONE]")); nativeID != "" || providerID != "" {
		t.Fatalf("DONE event produced ids: native=%q provider=%q", nativeID, providerID)
	}
}

func TestMediaIdempotencyReplayReturnsPersistedIdentity(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	response := httptest.NewRecorder()
	server.writeMediaReplay(response, request, store.MediaRequest{NativeTaskID: "resp_1", Model: "MiniMax-H3", BillingStatus: "submitted"})
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"id":"resp_1"`)) {
		t.Fatalf("unexpected response replay: status=%d body=%s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.writeMediaReplay(response, httptest.NewRequest(http.MethodPost, "/v1/videos", nil), store.MediaRequest{RequestID: "relay-1", BillingStatus: "accepted_unknown"})
	if response.Code != http.StatusConflict || !bytes.Contains(response.Body.Bytes(), []byte(`"type":"accepted_unknown"`)) {
		t.Fatalf("unexpected accepted-unknown replay: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestObservedSSEBodyPreservesBytesAndObservesTaskIDs(t *testing.T) {
	var observedNative, observedProvider string
	source := io.NopCloser(bytes.NewBufferString("data: {\"response\":{\"id\":\"resp_1\"},\"task_id\":\"provider_1\"}\n\ndata: [DONE]\n"))
	body := &observedSSEBody{source: source, onIDs: func(nativeID, providerID string) {
		observedNative, observedProvider = nativeID, providerID
	}}
	replayed, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(replayed) != "data: {\"response\":{\"id\":\"resp_1\"},\"task_id\":\"provider_1\"}\n\ndata: [DONE]\n" {
		t.Fatalf("SSE bytes were rewritten: %q", string(replayed))
	}
	if observedNative != "resp_1" || observedProvider != "provider_1" {
		t.Fatalf("SSE ids were not observed: native=%q provider=%q", observedNative, observedProvider)
	}
}

func TestProxyStreamsSSEWithoutBuffering(t *testing.T) {
	release := make(chan struct{})
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Set-Cookie", "upstream-session=secret")
		w.Header().Set("X-Request-ID", "upstream-request")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: first\n\n"))
		w.(http.Flusher).Flush()
		<-release
		_, _ = w.Write([]byte("data: second\n\n"))
	}))
	defer upstreamServer.Close()

	server := &Server{Transport: http.DefaultTransport}
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", "relay-request")
		server.proxy(w, r, upstreamServer.URL, "upstream-token", "request-1", nil)
	}))
	defer relayServer.Close()

	firstEvent := make(chan string, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		response, err := http.Get(relayServer.URL + "/v1/chat/completions")
		if err != nil {
			return
		}
		defer response.Body.Close()
		if response.Header.Get("Set-Cookie") != "" {
			t.Errorf("upstream cookie was forwarded")
			return
		}
		if values := response.Header.Values("X-Request-ID"); len(values) != 1 || values[0] != "relay-request" {
			t.Errorf("request IDs = %v", values)
		}
		scanner := bufio.NewScanner(response.Body)
		if scanner.Scan() {
			firstEvent <- scanner.Text()
		}
		for scanner.Scan() {
		}
	}()

	select {
	case event := <-firstEvent:
		if event != "data: first" {
			t.Fatalf("unexpected first event %q", event)
		}
	case <-time.After(time.Second):
		t.Fatal("proxy buffered the SSE response")
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("stream did not complete")
	}
}

func TestProxyRewritesInsufficientBalanceForTextRoutes(t *testing.T) {
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"code":"INSUFFICIENT_BALANCE","message":"","data":{"statusCode":403,"category":"custom_model_auth"}}`)
	}))
	defer upstreamServer.Close()

	server := &Server{
		Config:    config.Config{TextPaths: map[string]struct{}{"/v1/chat/completions": {}}},
		Transport: http.DefaultTransport,
	}
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.proxy(w, r, upstreamServer.URL, "upstream-token", "request-1", nil)
	}))
	defer relayServer.Close()

	response, err := http.Post(relayServer.URL+"/v1/chat/completions", "application/json", strings.NewReader(`{"model":"gpt-6.1-sol"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("status = %d, body = %s", response.StatusCode, body)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	errorPayload, ok := payload["error"].(map[string]any)
	if !ok || errorPayload["type"] != "billing_error" || errorPayload["code"] != "INSUFFICIENT_BALANCE" {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
	message, _ := errorPayload["message"].(string)
	if !strings.Contains(message, "https://cheapbuddy.cc/#pricing") {
		t.Fatalf("recharge URL missing from message: %q", message)
	}
	if errorPayload["recharge_url"] != "https://cheapbuddy.cc/#pricing" {
		t.Fatalf("recharge_url = %#v", errorPayload["recharge_url"])
	}
}

func TestProxyPreservesNonBalanceForbiddenForTextRoutes(t *testing.T) {
	upstreamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"code":"INVALID_API_KEY","message":"Invalid API key"}`)
	}))
	defer upstreamServer.Close()

	server := &Server{
		Config:    config.Config{TextPaths: map[string]struct{}{"/v1/chat/completions": {}}},
		Transport: http.DefaultTransport,
	}
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.proxy(w, r, upstreamServer.URL, "upstream-token", "request-1", nil)
	}))
	defer relayServer.Close()

	response, err := http.Post(relayServer.URL+"/v1/chat/completions", "application/json", strings.NewReader(`{"model":"gpt-6.1-sol"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != `{"code":"INVALID_API_KEY","message":"Invalid API key"}` {
		t.Fatalf("body was rewritten: %s", body)
	}
}
