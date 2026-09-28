export const meta = {
  apiVersion: 1,
  key: "ecophase_minimax_h3",
  name: "Qingyan MiniMax-H3",
  description: {
    en: "EcoPhase Qingyan MiniMax-H3 video generation",
    zh: "清衍智境 MiniMax-H3 视频生成",
  },
  version: "1.0.0",
  author: { name: "CheapBuddy" },
  models: ["MiniMax-H3"],
  fetchMode: "per_task",
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Actual or requested video duration in seconds.", zh: "实际或请求的视频时长，单位为秒。" },
    },
    resolution: {
      enum: ["768P"],
      description: { en: "Video output resolution.", zh: "视频输出分辨率。" },
    },
    context_ir_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Confirmed Context IR token usage when reported by Qingyan.", zh: "清衍返回的 Context IR 确认 token 用量。" },
    },
  },
  usageExamples: [
    { label: "768P · 8s · no Context IR tokens reported", facts: { seconds: 8, resolution: "768P", context_ir_tokens: 0 } },
  ],
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

const BASE_PATH = "/v2/video_generation";
const MAX_DURATION = 15;

function trimmed(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function numberValue(value, name, min, max, integer) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min || number > max) {
    throw new Error(name + " must be between " + min + " and " + max);
  }
  return number;
}

function mimeAllowed(mediaType, mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mediaType === "image_url") return ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"].indexOf(mime) >= 0;
  if (mediaType === "video_url") return ["video/mp4", "video/quicktime"].indexOf(mime) >= 0;
  if (mediaType === "audio_url") return ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"].indexOf(mime) >= 0;
  return false;
}

function validateReference(value, mediaType) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.__fileRef) {
    if (!/^request_file:[^\s]+$/i.test(String(value.__fileRef)) || ["base64", "dataUrl"].indexOf(String(value.encoding || "")) < 0) throw new Error("media file placeholder is not authorized");
    if (value.mimeType && !mimeAllowed(mediaType, value.mimeType)) throw new Error("media MIME type is not supported");
    return value;
  }
  const reference = trimmed(value);
  if (!reference) throw new Error("media reference must not be empty");
  if (/^https:\/\/[^\s]+$/i.test(reference)) {
    const authority = reference.slice(8).split(/[/?#]/)[0].toLowerCase();
    const host = authority.split("@").pop().split(":")[0];
    if (authority.indexOf("@") >= 0 || authority.indexOf("[") >= 0 || !host || host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "::1" || host.indexOf("127.") === 0 || host.indexOf("10.") === 0 || host.indexOf("192.168.") === 0 || host.indexOf("169.254.") === 0) throw new Error("media reference host is not allowed");
    const octets = host.split(".");
    if (octets.length === 4 && Number(octets[0]) === 172 && Number(octets[1]) >= 16 && Number(octets[1]) <= 31) throw new Error("media reference host is not allowed");
    return reference;
  }
  if (/^data:[^;,\s]+;base64,[A-Za-z0-9+/]*={0,2}$/i.test(reference)) {
    const mime = reference.slice(5, reference.indexOf(";"));
    if (!mimeAllowed(mediaType, mime)) throw new Error("media MIME type is not supported");
    if (reference.length > 64 * 1024 * 1024) throw new Error("Data URL exceeds the provider request limit");
    return reference;
  }
  throw new Error("media reference must be a safe HTTPS URL, Data URL, or NewAPI host file placeholder");
}

function filePlaceholder(ref, mimeType, maxBytes) {
  const placeholder = { __fileRef: ref, encoding: "dataUrl" };
  if (mimeType) placeholder.mimeType = mimeType;
  if (maxBytes !== undefined && maxBytes !== null) placeholder.maxBytes = maxBytes;
  return placeholder;
}

function durationOf(value) {
  return numberValue(value, "duration", 4, MAX_DURATION, true) || 6;
}

function resolutionOf(value) {
  const resolution = trimmed(value || "768P").toUpperCase();
  if (resolution !== "768P") throw new Error("resolution must be 768P");
  return resolution;
}

function ratioOf(value, hasReference) {
  const ratio = trimmed(value);
  if (!ratio) {
    if (hasReference) return "adaptive";
    throw new Error("ratio is required for text-to-video");
  }
  if (hasReference && ratio === "adaptive") return ratio;
  if (["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].indexOf(ratio) < 0) throw new Error("ratio is invalid");
  return ratio;
}

function contentItem(type, value, role) {
  const reference = validateReference(value, type);
  const item = { type: type };
  if (type === "image_url") item.image_url = { url: reference };
  if (type === "video_url") item.video_url = { url: reference };
  if (type === "audio_url") item.audio_url = { url: reference };
  if (role) item.role = role;
  return item;
}

function contentFromReferences(references) {
  return (references || []).map(function (reference) {
    return contentItem(reference.type, reference.url, reference.role);
  });
}

function normalizeReferences(request) {
  const references = [];
  function add(type, value, role) {
    if (value === undefined || value === null || value === "") return;
    references.push({ type: type, url: validateReference(value, type), role: role });
  }
  const content = request.content;
  if (Array.isArray(content)) {
    content.forEach(function (item) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("content items must be objects");
      const type = trimmed(item.type);
      if (["image_url", "video_url", "audio_url"].indexOf(type) < 0) throw new Error("unsupported content type: " + type);
      const field = item[type] || {};
      add(type, field.url || item.url, item.role);
    });
  }
  if (request.first_frame !== undefined) add("image_url", request.first_frame, "first_frame");
  if (request.last_frame !== undefined) add("image_url", request.last_frame, "last_frame");
  if (request.input_reference !== undefined) add("image_url", request.input_reference, "first_frame");
  if (request.reference_image !== undefined) add("image_url", request.reference_image, "reference_image");
  if (request.reference_video !== undefined) add("video_url", request.reference_video, "reference_video");
  if (request.reference_audio !== undefined) add("audio_url", request.reference_audio, "reference_audio");
  if (Array.isArray(request.images)) request.images.forEach(function (value, index) { add("image_url", value, index === 0 ? "first_frame" : index === 1 ? "last_frame" : "reference_image"); });
  return references;
}

function validateRoles(references) {
  const counts = {};
  references.forEach(function (reference) {
    if (!reference.role) reference.role = reference.type === "image_url" ? "first_frame" : reference.type === "video_url" ? "reference_video" : "reference_audio";
    counts[reference.role] = (counts[reference.role] || 0) + 1;
  });
  if ((counts.first_frame || 0) > 1 || (counts.last_frame || 0) > 1) throw new Error("first_frame and last_frame may appear at most once");
  return references;
}

function promptOf(request) {
  const prompt = trimmed(request.prompt);
  if (!prompt) throw new Error("prompt is required");
  return prompt;
}

function canonicalRequest(request) {
  if (request.callback_url !== undefined) throw new Error("callback_url is not supported");
  const references = validateRoles(normalizeReferences(request));
  const prompt = promptOf(request);
  const duration = durationOf(request.duration === undefined ? request.seconds : request.duration);
  const resolution = resolutionOf(request.resolution || request.size);
  const ratio = ratioOf(request.ratio, references.length > 0);
  return {
    model: "MiniMax-H3",
    prompt: prompt,
    references: references,
    duration: duration,
    resolution: resolution,
    ratio: ratio,
    context_ir_enabled: request.context_ir_enabled === false ? false : true,
    aigc_watermark: request.aigc_watermark === true,
  };
}

function responsesInput(request) {
  const texts = [];
  const references = [];
  const input = request.input;
  if (typeof input === "string") texts.push(input);
  else if (Array.isArray(input)) {
    input.forEach(function (item) {
      if (typeof item === "string") {
        texts.push(item);
        return;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const parts = item.content === undefined ? [item] : Array.isArray(item.content) ? item.content : [item.content];
      parts.forEach(function (part) {
        if (typeof part === "string") {
          texts.push(part);
          return;
        }
        if (!part || typeof part !== "object" || Array.isArray(part)) return;
        if (["input_text", "text"].indexOf(part.type) >= 0 && typeof part.text === "string") texts.push(part.text);
        const types = [
          ["input_image", "image_url", "image_url", "image"],
          ["input_video", "video_url", "video_url", "reference_video"],
          ["input_audio", "audio_url", "audio_url", "reference_audio"],
        ];
        types.forEach(function (entry) {
          if (entry.slice(0, 2).indexOf(part.type) >= 0) {
            let value = part[entry[1]];
            if (value && typeof value === "object") value = value.url;
            if (trimmed(value)) {
              let role = entry[3];
              if (role === "image") {
                const imageCount = references.filter(function (reference) { return reference.type === "image_url"; }).length;
                role = imageCount === 0 ? "first_frame" : imageCount === 1 ? "last_frame" : "reference_image";
              }
              if (part.role) role = part.role;
              references.push({ type: entry[2], url: validateReference(value, entry[2]), role: role });
            }
          }
        });
      });
    });
  }
  return { prompt: texts.map(trimmed).filter(function (value) { return value; }).join("\n"), references: references };
}

function responseRequest(request) {
  const parsed = responsesInput(request);
  const merged = {
    prompt: parsed.prompt || request.prompt,
    content: parsed.references.map(function (reference) {
      const item = { type: reference.type, role: reference.role };
      item[reference.type] = { url: reference.url };
      return item;
    }),
    seconds: request.seconds === undefined ? request.duration : request.seconds,
    resolution: request.size || request.resolution,
    ratio: request.ratio,
    context_ir_enabled: request.context_ir_enabled,
    aigc_watermark: request.aigc_watermark,
    callback_url: request.callback_url,
  };
  if (request.image || request.input_reference) merged.first_frame = request.image || request.input_reference;
  return canonicalRequest(merged);
}

function providerBody(request) {
  const body = {
    model: "MiniMax-H3",
    content: [{ type: "text", text: request.prompt }].concat(contentFromReferences(request.references)),
    resolution: request.resolution,
    duration: request.duration,
    ratio: request.ratio,
    context_ir_enabled: request.context_ir_enabled,
    aigc_watermark: request.aigc_watermark,
  };
  return body;
}

function actionFor(request) {
  if ((request.references || []).some(function (reference) { return reference.type !== "image_url" || String(reference.role || "").indexOf("reference_") === 0; })) return "reference_to_video";
  return request.references && request.references.length ? "image_to_video" : "text_to_video";
}

function providerHeaders(ctx) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: "Bearer " + ctx.apiKey,
    "Idempotency-Key": "newapi-" + trimmed(ctx.publicTaskId || "task"),
  };
}

function taskOf(body) {
  return body && body.task && typeof body.task === "object" ? body.task : {};
}

function errorMessage(task) {
  return task && task.error && (task.error.message || task.error.code) ? String(task.error.message || task.error.code) : "video generation failed";
}

function artifactURL(data) {
  const task = taskOf(data || {});
  const url = task.content && task.content.url;
  if (!/^https:\/\/[^\s]+$/i.test(String(url || ""))) return "";
  return String(url);
}

export function buildSubmitRequest(ctx) {
  const request = ctx.requestBody || {};
  const canonical = request.references ? request : canonicalRequest(request);
  return {
    url: ctx.baseUrl + BASE_PATH,
    method: "POST",
    headers: providerHeaders(ctx),
    body: providerBody(canonical),
    action: ctx.action || actionFor(canonical),
  };
}

export function parseSubmitResponse(_ctx, response) {
  const body = response.body || {};
  if (!body.task_id) throw new Error("Qingyan response missing task_id");
  return { taskId: String(body.task_id), taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v2/query/video_generation/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(_ctx, body) {
  const task = taskOf(body || {});
  const states = { queued: "QUEUED", running: "IN_PROGRESS", succeeded: "SUCCESS", failed: "FAILURE", cancelled: "FAILURE" };
  const rawStatus = String(task.status || "").toLowerCase();
  const status = states[rawStatus] || "UNKNOWN";
  const result = { taskId: String(task.id || ""), status: status, data: body };
  if (status === "SUCCESS" || status === "FAILURE") result.progress = "100%";
  if (status === "FAILURE") result.reason = errorMessage(task);
  if (status === "UNKNOWN") result.reason = "unknown Qingyan task status: " + rawStatus;
  return result;
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const request = ctx.requestBody || {};
  const canonical = request.references ? request : canonicalRequest(request);
  return { seconds: canonical.duration, resolution: canonical.resolution, context_ir_tokens: 0 };
}

export function extractUsageOnComplete(_task, _result, body) {
  const task = taskOf(body || {});
  const usage = task.context_ir && task.context_ir.usage ? task.context_ir.usage : {};
  const tokens = Number(usage.total_tokens || 0);
  return {
    seconds: Number(task.duration || 0),
    resolution: resolutionOf(task.resolution || "768P"),
    context_ir_tokens: Number.isFinite(tokens) && tokens >= 0 ? tokens : 0,
  };
}

function responseVideoText(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  const escaped = url.replace(/&/g, "&amp;").replace(/\"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" && artifactURL(task.data) ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const url = artifactURL(ctx.data);
  if (!url) throw new Error("artifact_not_found");
  return {
    url: url,
    method: ctx.clientRequest.method,
    // Qingyan returns a time-limited OSS URL. The signature in the URL is the
    // credential; forwarding the provider API key would be unnecessary and
    // would make the host validate the artifact against the provider base URL.
    credentialless: true,
  };
}

export const protocols = {
  openai_responses: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const request = ctx.body.value;
      if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("request body must be an object");
      if (trimmed(request.model) !== "MiniMax-H3") throw new Error("model must be MiniMax-H3");
      const canonical = responseRequest(request);
      return { kind: "submit", model: ctx.model, action: actionFor(canonical), requestBody: canonical };
    },
    renderEvents: function (ctx, task, previousState) {
      const status = String(task.status || "UNKNOWN").toUpperCase();
      const state = { status: status };
      if (status === "SUCCESS") {
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: responseVideoText(ctx) }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE") return { events: [{ type: "error", code: "task_failed", message: task.fail_reason || "task failed" }], state: state, done: true };
      if (previousState && previousState.status === status) return { events: [], state: state, done: false };
      return { events: [{ type: "progress", message: status.toLowerCase() }], state: state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [{ type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: responseVideoText(ctx), annotations: [], logprobs: [] }] }],
        metadata: { vendor: "ecophase_minimax_h3" },
      };
    },
  },
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
      if (ctx.body.kind === "json") {
        const request = ctx.body.value;
        if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("JSON body must be an object");
        if (trimmed(request.model) !== "MiniMax-H3") throw new Error("model must be MiniMax-H3");
        const canonical = canonicalRequest(request);
        return { kind: "submit", model: ctx.model, action: actionFor(canonical), requestBody: canonical };
      }
      const fields = ctx.body.fields || {};
      const request = {};
      Object.keys(fields).forEach(function (name) {
        if (!fields[name] || fields[name].length !== 1) throw new Error(name + " must be provided once");
        request[name] = fields[name][0];
      });
      if (trimmed(request.model) !== "MiniMax-H3") throw new Error("model must be MiniMax-H3");
      (ctx.body.files || []).forEach(function (file) {
        const mapping = {
          input_reference: ["image_url", "first_frame", "image/*", 30 * 1024 * 1024],
          first_frame: ["image_url", "first_frame", "image/*", 30 * 1024 * 1024],
          last_frame: ["image_url", "last_frame", "image/*", 30 * 1024 * 1024],
          reference_image: ["image_url", "reference_image", "image/*", 30 * 1024 * 1024],
          reference_video: ["video_url", "reference_video", "video/*", 50 * 1024 * 1024],
          reference_audio: ["audio_url", "reference_audio", "audio/*", 15 * 1024 * 1024],
        }[file.field];
        if (!mapping) throw new Error("unsupported media field: " + file.field);
        const item = { type: mapping[0], role: mapping[1] };
        item[mapping[0]] = { url: filePlaceholder(file.ref, file.mimeType || mapping[2], mapping[3]) };
        request.content = (request.content || []).concat([item]);
      });
      if (request.duration !== undefined) request.duration = Number(request.duration);
      if (request.seconds !== undefined) request.seconds = Number(request.seconds);
      const canonical = canonicalRequest(request);
      return { kind: "submit", model: ctx.model, action: actionFor(canonical), requestBody: canonical };
    },
    render: function (_ctx, task) {
      const statuses = { QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
      const output = { id: task.task_id, object: "video", model: "MiniMax-H3", status: statuses[task.status] || "unknown", created_at: task.created_at };
      if (task.updated_at) output.completed_at = task.updated_at;
      if (task.status === "FAILURE") output.error = { code: "video_generation_failed", message: task.fail_reason || "video generation failed" };
      return output;
    },
  },
};
