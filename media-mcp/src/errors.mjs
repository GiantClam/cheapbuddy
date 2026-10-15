const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /(?:api[_-]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
];

export class MediaMcpError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "MediaMcpError";
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable === true;
    this.ambiguous = options.ambiguous === true;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export function redactSecrets(value) {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match) => {
      const separator = match.indexOf("=") >= 0 ? "=" : ":";
      return match.slice(0, Math.max(0, match.indexOf(separator) + 1)) + "[redacted]";
    });
  }
  return text.replace(/https?:\/\/[^\s/]+\/[^\s]*/gi, (url) => {
    try {
      const parsed = new URL(url);
      parsed.username = "";
      parsed.password = "";
      for (const key of ["key", "token", "signature", "sig", "secret"]) {
        if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[redacted]");
      }
      return parsed.toString();
    } catch {
      return "[redacted-url]";
    }
  });
}

export function publicError(error) {
  if (error instanceof MediaMcpError) {
    return {
      code: error.code,
      message: redactSecrets(error.message),
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(error.retryAfterMs === undefined ? {} : { retry_after_ms: error.retryAfterMs }),
    };
  }
  return {
    code: "internal_error",
    message: "CheapBuddy Media MCP could not complete the request.",
  };
}

export function validationError(message, details) {
  return new MediaMcpError("invalid_request", message, { details });
}

export function configurationError(message) {
  return new MediaMcpError("configuration_error", message);
}

export function httpError(status, message, options = {}) {
  const retryAfterMs = options.retryAfterMs;
  return new MediaMcpError(options.code || httpCode(status), message, {
    status,
    retryAfterMs,
    retryable: options.retryable,
    ambiguous: options.ambiguous,
    details: options.details,
  });
}

function httpCode(status) {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 404) return "not_found";
  if (status === 409) return "idempotency_conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_error";
  return "request_failed";
}

export function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${name} must be an object.`);
  }
  return value;
}

export function assertNoUnknownKeys(value, allowed, name = "request") {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) throw validationError(`${name} contains unsupported field: ${key}.`);
  }
}
