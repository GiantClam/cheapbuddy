import { encodeJobId } from "./job-id.mjs";
import { validationError } from "./errors.mjs";

const STATUS_MAP = new Map([
  ["queued", "queued"], ["queue", "queued"], ["pending", "queued"], ["not_start", "queued"], ["submitted", "queued"],
  ["running", "in_progress"], ["in_progress", "in_progress"], ["processing", "in_progress"], ["started", "in_progress"],
  ["success", "completed"], ["succeeded", "completed"], ["completed", "completed"], ["done", "completed"], ["finish", "completed"],
  ["failure", "failed"], ["failed", "failed"], ["error", "failed"], ["cancelled", "failed"], ["canceled", "failed"], ["expired", "failed"], ["released", "failed"],
]);

export async function normalizeImageResponse(payload, context) {
  const taskId = extractImageTaskId(payload);
  const rawStatus = extractStatus(payload);
  const status = rawStatus || (Array.isArray(payload?.data) ? "completed" : taskId ? "in_progress" : "unknown");
  const media = [];
  const inlineImages = [];
  const rows = imageRows(payload);
  for (const row of rows) {
    const imageUrl = row.url || row.image_url;
    if (typeof imageUrl === "string" && isHttpsUrl(imageUrl)) {
      media.push({ url: imageUrl, mime_type: imageMime(row.mime_type || row.content_type || imageUrl), ...(row.expires_at ? { expires_at: row.expires_at } : {}) });
    }
    if (typeof row.b64_json === "string") {
      const decoded = decodeImageBase64(row.b64_json);
      const uploaded = await context.backend.uploadResult(decoded.bytes, decoded.mimeType);
      const url = uploaded?.url || uploaded?.data?.url;
      if (!isHttpsUrl(url)) throw validationError("Relay did not return a safe temporary image URL.");
      media.push({ url, mime_type: decoded.mimeType, ...(uploaded.expires_at ? { expires_at: uploaded.expires_at } : {}) });
      inlineImages.push({ type: "image", data: decoded.bytes.toString("base64"), mimeType: decoded.mimeType });
    }
  }
  const id = taskId ? encodeJobId("image", taskId) : null;
  return buildJob({
    kind: "image", model: context.model, id, status: media.length ? "completed" : status, request: context.request,
    media, inlineImages, payload, pollAfterMs: media.length || ["completed", "failed"].includes(status) ? undefined : pollAfter(payload),
  });
}

export function normalizeVideoResponse(payload, context) {
  const taskId = extractTaskId(payload);
  const status = extractStatus(payload) || (taskId ? "queued" : "unknown");
  const media = [];
  if (status === "completed") {
    const artifact = extractArtifactUrl(payload);
    const downloadUrl = payload?.download_url || payload?.data?.download_url || payload?.task?.download_url;
    if (downloadUrl && context.backend?.isRelayUrl?.(downloadUrl)) {
      media.push({ url: downloadUrl, mime_type: "video/mp4", ...(payload?.download_url_expires_at ? { expires_at: payload.download_url_expires_at } : {}), ...(extractExpiry(payload) ? { expires_at: extractExpiry(payload) } : {}) });
    } else if (taskId && context.backend) {
      // Always prefer the Relay capability URL. A provider-signed URL in a
      // NewAPI task payload must not become an MCP-visible provider boundary.
      media.push({ url: context.backend.videoContentUrl(taskId), mime_type: "video/mp4", requires_auth: true, ...(extractExpiry(payload) ? { expires_at: extractExpiry(payload) } : {}) });
    } else if (artifact && context.backend?.isRelayUrl?.(artifact)) {
      media.push({ url: artifact, mime_type: "video/mp4", ...(extractExpiry(payload) ? { expires_at: extractExpiry(payload) } : {}) });
    }
  }
  return buildJob({
    kind: "video", model: context.model, id: taskId ? encodeJobId("video", taskId) : null, status,
    request: context.request, media, payload, pollAfterMs: status === "completed" ? undefined : pollAfter(payload),
  });
}

export function normalizeQueriedJob(kind, payload, context) {
  return kind === "image" ? normalizeImageResponse(payload, context) : normalizeVideoResponse(payload, context);
}

export function buildJob({ kind, model, id, status, request, media = [], inlineImages = [], payload, pollAfterMs }) {
  const job = {
    object: "media_job",
    id,
    media_type: kind,
    model,
    status: normalizeStatus(status),
    request: request ? structuredClone(request) : undefined,
    media,
    usage: extractUsage(payload),
    billing: extractBilling(payload),
    ...(pollAfterMs === undefined ? {} : { poll_after_ms: pollAfterMs }),
  };
  if (job.status === "failed") job.error = extractError(payload);
  if (payload?.accepted_unknown === true || payload?.error?.type === "accepted_unknown") job.accepted_unknown = true;
  if (job.request === undefined) delete job.request;
  return { job, inlineImages };
}

export function extractTaskId(value) {
  const seen = new Set();
  const visit = (node, depth = 0) => {
    if (!node || depth > 4 || typeof node !== "object" || seen.has(node)) return "";
    seen.add(node);
    for (const key of ["task_id", "id", "response_id"]) {
      if (typeof node[key] === "string" && node[key].trim() && !node[key].startsWith("http")) return node[key].trim();
    }
    for (const key of ["data", "task", "result", "response", "output"]) {
      const found = visit(node[key], depth + 1);
      if (found) return found;
    }
    return "";
  };
  return visit(value);
}

function extractImageTaskId(payload) {
  if (!payload || typeof payload !== "object") return "";
  for (const key of ["task_id", "taskId"]) {
    if (typeof payload[key] === "string" && payload[key].trim()) return payload[key].trim();
  }
  if (typeof payload.id === "string" && ["queued", "in_progress", "failed", "unknown"].includes(extractStatus(payload))) return payload.id.trim();
  if (payload.task && typeof payload.task === "object") return extractTaskId(payload.task);
  if (payload.data && !Array.isArray(payload.data) && typeof payload.data === "object") {
    if (payload.data.task_id || payload.data.taskId) return extractTaskId(payload.data);
    if (payload.data.status && payload.data.id) return String(payload.data.id);
  }
  // An image response row's `id` identifies an output object, not a Relay
  // processing task. Do not turn it into a resumable task ID.
  return "";
}

export function extractStatus(value) {
  const seen = new Set();
  const visit = (node, depth = 0) => {
    if (!node || depth > 4 || typeof node !== "object" || seen.has(node)) return "";
    seen.add(node);
    for (const key of ["status", "task_status", "state"]) {
      const raw = String(node[key] || "").trim().toLowerCase();
      if (raw && STATUS_MAP.has(raw)) return STATUS_MAP.get(raw);
    }
    for (const key of ["data", "task", "result", "response", "output"]) {
      const found = visit(node[key], depth + 1);
      if (found) return found;
    }
    return "";
  };
  return visit(value);
}

export function pollAfter(payload) {
  const raw = payload?.poll_after_ms ?? payload?.data?.poll_after_ms ?? payload?.task?.poll_after_ms;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.max(Math.round(number), 500), 10000) : 2000;
}

function imageRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data.filter((row) => row && typeof row === "object");
  if (payload?.data && typeof payload.data === "object") return [payload.data];
  if (payload && typeof payload === "object" && (payload.url || payload.image_url || payload.b64_json)) return [payload];
  return [];
}

function decodeImageBase64(value) {
  const encoded = value.replace(/^data:([^;,]+);base64,/iu, "").replace(/\s+/gu, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 === 1) throw validationError("Relay returned invalid base64 image data.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0 || bytes.length > 30 * 1024 * 1024) throw validationError("Relay returned an oversized image.");
  const mimeType = detectImageMime(bytes);
  if (!mimeType) throw validationError("Relay returned unsupported image bytes.");
  return { bytes, mimeType };
}

function detectImageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  return "";
}

function imageMime(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("png")) return "image/png";
  if (text.includes("webp")) return "image/webp";
  if (text.includes("gif")) return "image/gif";
  return "image/jpeg";
}

function extractArtifactUrl(payload) {
  const candidates = [
    payload?.url, payload?.video_url, payload?.content_url,
    payload?.content?.url, payload?.video?.url, payload?.artifact?.url,
    payload?.data?.url, payload?.data?.video_url, payload?.data?.content_url,
    payload?.data?.content?.url, payload?.data?.video?.url, payload?.task?.content?.url,
  ];
  return candidates.find(isHttpsUrl) || "";
}

function extractExpiry(payload) {
  return payload?.expires_at || payload?.data?.expires_at || payload?.content?.expires_at || payload?.artifact?.expires_at || null;
}

function extractUsage(payload) {
  const usage = payload?.usage || payload?.data?.usage || payload?.task?.usage;
  return usage && typeof usage === "object" ? structuredClone(usage) : null;
}

function extractBilling(payload) {
  const source = payload?.billing || payload?.data?.billing || {};
  const fields = {};
  for (const key of ["status", "amount", "currency", "reservation", "reservation_id", "ledger_id", "estimated_amount_usd", "final_amount_usd", "message"]) {
    if (source[key] !== undefined && source[key] !== null) fields[key] = source[key];
  }
  if (payload?.cheapbuddy) fields.cheapbuddy = structuredClone(payload.cheapbuddy);
  return Object.keys(fields).length ? fields : { status: "pending_final_charge" };
}

function extractError(payload) {
  const source = payload?.error || payload?.data?.error || payload?.task?.error || {};
  const message = typeof source === "string" ? source : source.message || source.code || "Media task failed.";
  return { code: String(source.code || "media_task_failed"), message: String(message).slice(0, 500) };
}

function normalizeStatus(value) {
  return STATUS_MAP.get(String(value || "").toLowerCase()) || "unknown";
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
