import { randomUUID } from "node:crypto";
import { configurationError, httpError, MediaMcpError, redactSecrets } from "./errors.mjs";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const READ_RETRY_DELAYS = [250, 750];

export class CheapBuddyHttpClient {
  constructor(options = {}) {
    const apiKey = String(options.apiKey ?? process.env.CHEAPBUDDY_API_KEY ?? "").trim();
    if (!apiKey) throw configurationError("CHEAPBUDDY_API_KEY is required.");
    if (apiKey.length > 4096 || /[\r\n]/u.test(apiKey)) throw configurationError("CHEAPBUDDY_API_KEY is invalid.");
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl || process.env.CHEAPBUDDY_BASE_URL || "https://api.cheapbuddy.cc");
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw configurationError("This Node.js runtime does not provide fetch.");
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1000, options.timeoutMs) : 60000;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.requestId = options.requestId || (() => randomUUID());
  }

  async json(method, path, body, options = {}) {
    return this.request(method, path, { ...options, body, json: true });
  }

  async readJson(method, path, options = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await this.request(method, path, options);
      } catch (error) {
        if (!shouldRetryRead(error) || attempt >= READ_RETRY_DELAYS.length) throw error;
        const delay = error.retryAfterMs ?? READ_RETRY_DELAYS[attempt];
        attempt += 1;
        await this.sleep(Math.min(Math.max(delay, 0), 10000));
      }
    }
  }

  async uploadMedia(bytes, mimeType, options = {}) {
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError("bytes must be binary data");
    return this.request("POST", "/v1/media", {
      body: bytes,
      contentType: mimeType,
      ...options,
    });
  }

  async request(method, requestPath, options = {}) {
    const url = this.buildUrl(requestPath);
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("X-Request-ID", this.requestId());
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
    let body = options.body;
    if (options.json) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body ?? {});
    } else if (options.contentType) {
      headers.set("Content-Type", options.contentType);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (error) {
      throw new MediaMcpError("network_error", "CheapBuddy Relay could not be reached.", {
        retryable: method === "GET" || method === "HEAD",
        ambiguous: method !== "GET" && method !== "HEAD",
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
    const text = await readBoundedText(response);
    const payload = parsePayload(text, response.headers.get("content-type"));
    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const message = safeRemoteMessage(payload, response.status);
      throw httpError(response.status, message, {
        retryAfterMs,
        retryable: response.status === 429 || response.status >= 500,
        ambiguous: response.status >= 500 && method !== "GET" && method !== "HEAD",
        code: payload?.error?.type || undefined,
        details: { status: response.status },
      });
    }
    return payload;
  }

  buildUrl(requestPath) {
    if (typeof requestPath !== "string" || !requestPath.startsWith("/")) throw new Error("Relay path must be absolute.");
    return new URL(requestPath, this.baseUrl).toString();
  }
}

export function normalizeBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw configurationError("CHEAPBUDDY_BASE_URL is invalid.");
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw configurationError("CHEAPBUDDY_BASE_URL must be an HTTP(S) origin without credentials or query parameters.");
  }
  return parsed.toString().replace(/\/$/u, "");
}

async function readBoundedText(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new MediaMcpError("response_too_large", "Relay response exceeded the safety limit.");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new MediaMcpError("response_too_large", "Relay response exceeded the safety limit.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new MediaMcpError("response_too_large", "Relay response exceeded the safety limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function parsePayload(text, contentType) {
  if (!text) return {};
  if (String(contentType || "").includes("json") || /^[\s]*[\[{]/u.test(text)) {
    try { return JSON.parse(text); } catch { return { error: { message: "Relay returned malformed JSON." } }; }
  }
  return { raw: text.slice(0, 512) };
}

function safeRemoteMessage(payload, status) {
  const candidate = payload?.error?.message || payload?.message || payload?.error || `Relay request failed with HTTP ${status}.`;
  const message = redactSecrets(typeof candidate === "string" ? candidate : "Relay request failed.")
    .replace(/https?:\/\/[^\s)]+/giu, "[redacted-url]");
  return message.length > 500 ? message.slice(0, 500) : message;
}

function parseRetryAfter(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10000);
  return undefined;
}

function shouldRetryRead(error) {
  return error instanceof MediaMcpError && (error.retryable === true || error.code === "rate_limited") && !error.ambiguous;
}

export { MAX_RESPONSE_BYTES };
