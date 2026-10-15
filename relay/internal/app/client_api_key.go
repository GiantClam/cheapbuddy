package app

import (
	"net/http"
	"strings"
)

// clientAPIKey keeps Bearer authoritative and accepts Anthropic SDK keys only
// on native text and model discovery routes. It never broadens media access.
func clientAPIKey(r *http.Request, pathName string) string {
	if authorization := strings.TrimSpace(r.Header.Get("Authorization")); authorization != "" {
		return bearer(authorization)
	}
	switch pathName {
	case "/v1/messages", "/v1/messages/count_tokens", "/v1/models":
		return strings.TrimSpace(r.Header.Get("X-Api-Key"))
	default:
		if modelDetailPath.MatchString(pathName) {
			return strings.TrimSpace(r.Header.Get("X-Api-Key"))
		}
		return ""
	}
}
