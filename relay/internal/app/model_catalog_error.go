package app

import "net/http"

func writeModelCatalogError(w http.ResponseWriter, status int) {
	switch status {
	case http.StatusUnauthorized:
		writeError(w, status, "authentication_error", "Invalid API key")
	case http.StatusForbidden:
		writeError(w, status, "permission_error", "This API key cannot access a model group. Check its group and account permissions")
	case http.StatusTooManyRequests:
		w.Header().Set("Retry-After", "60")
		writeError(w, status, "rate_limit_error", "Model catalog rate limit exceeded")
	default:
		writeError(w, status, "upstream_error", "Model list unavailable")
	}
}
