package app

import (
	"net/http"
	"strings"
)

// canonicalPublicTextPath only normalizes explicitly supported SDK text paths.
// It never turns an arbitrary path into a public proxy route.
func canonicalPublicTextPath(name string) string {
	switch name {
	case "/messages", "/v1/v1/messages":
		return "/v1/messages"
	case "/messages/count_tokens", "/v1/v1/messages/count_tokens":
		return "/v1/messages/count_tokens"
	case "/chat/completions", "/v1/v1/chat/completions":
		return "/v1/chat/completions"
	case "/responses", "/v1/v1/responses":
		return "/v1/responses"
	case "/systemone", "/v1/v1/systemone":
		return "/v1/systemone"
	case "/models", "/v1/v1/models":
		return "/v1/models"
	}
	for _, prefix := range []string{"/models/", "/v1/v1/models/"} {
		if strings.HasPrefix(name, prefix) {
			canonical := "/v1/models/" + strings.TrimPrefix(name, prefix)
			if modelDetailPath.MatchString(canonical) {
				return canonical
			}
		}
	}
	return name
}

func isNativeMessagePath(name string) bool {
	return name == "/v1/messages" || name == "/v1/messages/count_tokens"
}

func isNativeSystemOnePath(name string) bool {
	return name == "/v1/systemone"
}

func isNativeProtocolPath(name string) bool {
	return isNativeMessagePath(name) || isNativeSystemOnePath(name)
}

// Only HTTP metadata selects a native catalog. No model content is interpreted.
// Codex discovery has its own Sub2API envelope and must also stay unmodified.
func isOpaqueSub2APIRequest(r *http.Request, name string) bool {
	if isNativeProtocolPath(name) {
		return true
	}
	if name != "/v1/models" && !modelDetailPath.MatchString(name) {
		return false
	}
	return r.Header.Get("Anthropic-Version") != "" || r.Header.Get("Anthropic-Beta") != "" || r.Header.Get("X-Api-Key") != "" || (name == "/v1/models" && r.URL.Query().Get("client_version") != "")
}

func (s *Server) proxyOpaqueSub2API(w http.ResponseWriter, r *http.Request, key, requestID string) {
	if isNativeProtocolPath(r.URL.Path) && r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not available")
		return
	}
	if !isNativeProtocolPath(r.URL.Path) && r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not available")
		return
	}
	if !s.allowTextRate(r.Context(), key) {
		w.Header().Set("Retry-After", "60")
		writeError(w, http.StatusTooManyRequests, "rate_limit_error", "Rate limit exceeded")
		return
	}
	if r.Body != nil && s.Config.MaxBodyBytes > 0 {
		if r.ContentLength > s.Config.MaxBodyBytes {
			writeError(w, http.StatusRequestEntityTooLarge, "invalid_request_error", "Request body too large")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, s.Config.MaxBodyBytes)
	}
	s.proxy(w, r, s.Config.Sub2APIURL, key, requestID, nil)
}
