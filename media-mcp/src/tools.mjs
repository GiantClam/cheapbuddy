import { randomUUID } from "node:crypto";
import { assertNoUnknownKeys, assertPlainObject, publicError, validationError } from "./errors.mjs";
import { findMediaModel, modelAllowsOperation, allowedParameterNames } from "./catalog.mjs";
import { decodeJobId } from "./job-id.mjs";
import { normalizeImageResponse, normalizeQueriedJob, normalizeVideoResponse } from "./normalize.mjs";
import { validateMediaInput } from "./media-input.mjs";

export const TOOL_NAMES = Object.freeze([
  "cheapbuddy_list_media_models",
  "cheapbuddy_quote_image",
  "cheapbuddy_generate_image",
  "cheapbuddy_quote_video",
  "cheapbuddy_submit_video",
  "cheapbuddy_get_media_job",
]);

const WRITE_NOTICE = "This operation consumes CheapBuddy account balance; no budget or confirmation step is used.";

export function toolDefinitions() {
  return [
    {
      name: "cheapbuddy_list_media_models",
      description: "List image and video models visible to the current CheapBuddy API key, including capabilities and conservative parameter schemas.",
      inputSchema: { type: "object", additionalProperties: false, properties: { refresh: { type: "boolean", default: false } } },
      annotations: { title: "List CheapBuddy media models", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "cheapbuddy_quote_image",
      description: "Read an optional image rate card or non-exact estimate. This never locks balance and is not required before generation.",
      inputSchema: imageQuoteSchema(),
      annotations: { title: "Quote image pricing", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "cheapbuddy_generate_image",
      description: `Generate, edit, or vary an image through CheapBuddy Relay. ${WRITE_NOTICE}`,
      inputSchema: imageGenerateSchema(),
      annotations: { title: "Generate or edit image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    {
      name: "cheapbuddy_quote_video",
      description: "Read an optional MiniMax-H3 rate card or duration estimate. This never locks balance and is not required before submission.",
      inputSchema: videoQuoteSchema(),
      annotations: { title: "Quote video pricing", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    {
      name: "cheapbuddy_submit_video",
      description: `Submit a non-blocking MiniMax-H3 video task with text, frame, image, video, or audio references. ${WRITE_NOTICE}`,
      inputSchema: videoSubmitSchema(),
      annotations: { title: "Submit H3 video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    {
      name: "cheapbuddy_get_media_job",
      description: "Query one MCP-generated image or video job ID. Video queries are bounded and never block until completion.",
      inputSchema: { type: "object", additionalProperties: false, required: ["job_id"], properties: { job_id: { type: "string", minLength: 12 } } },
      annotations: { title: "Get media job", readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
  ];
}

export function createToolHandlers({ backend, sleep, now } = {}) {
  if (!backend) throw new Error("backend is required");
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const clock = now || (() => Date.now());
  const handlers = {
    cheapbuddy_list_media_models: async (args) => {
      assertPlainObject(args, "arguments");
      assertNoUnknownKeys(args, new Set(["refresh"]));
      const rows = await backend.listMediaModels({ refresh: args.refresh === true });
      return successResult({ object: "media_model_list", data: rows });
    },

    cheapbuddy_quote_image: async (args) => {
      assertPlainObject(args, "arguments");
      assertNoUnknownKeys(args, new Set(["model", "operation"]));
      const model = await resolveModel(args.model, "image");
      const operation = args.operation || "generate";
      if (!modelAllowsOperation(model, operation)) throw validationError(`Model does not advertise image operation: ${operation}.`);
      const payload = await backend.quote(model.id, {});
      return successResult(imageQuote(payload, model, operation));
    },

    cheapbuddy_generate_image: async (args) => {
      assertPlainObject(args, "arguments");
      assertNoUnknownKeys(args, new Set(["model", "operation", "prompt", "images", "mask", "parameters", "wait_seconds", "idempotency_key"]));
      let model = await resolveModel(args.model, "image");
      const operation = requireEnum(args.operation, ["generate", "edit", "variation"], "operation");
      if (!modelAllowsOperation(model, operation)) {
        backend.invalidateCatalog();
        model = await resolveModel(args.model, "image");
        if (!modelAllowsOperation(model, operation)) throw validationError(`Model does not advertise image operation: ${operation}.`);
      }
      const prompt = optionalText(args.prompt, "prompt");
      const images = arrayOrEmpty(args.images, "images");
      const mask = args.mask === undefined ? undefined : validateMediaInput(args.mask, "image");
      const waitSeconds = normalizeWaitSeconds(args.wait_seconds);
      if (operation !== "variation" && !prompt) throw validationError("prompt is required for image generation and editing.");
      if (operation !== "generate" && images.length === 0) throw validationError(`${operation} requires at least one image input.`);
      if (operation === "generate" && images.length) throw validationError("generate does not accept image inputs; use edit or variation.");
      if (operation !== "edit" && mask) throw validationError("mask is supported only for operation edit.");
      const maxImages = model.max_images || 1;
      if (images.length > maxImages) throw validationError(`This model accepts at most ${maxImages} image input(s).`);
      const parameters = validateParameters(args.parameters, model);
      const request = { operation, prompt: prompt || undefined, image_count: images.length, ...(mask ? { mask: true } : {}), parameters };
      let normalized;
      try {
        const response = await backend.createImage({ model: model.id, operation, prompt, images, mask, parameters, idempotencyKey: normalizeIdempotencyKey(args.idempotency_key) });
        normalized = await normalizeImageResponse(response, { backend, model: model.id, request });
      } catch (error) {
        if (!error.ambiguous) throw error;
        return successResult(acceptedUnknown("image", model.id, request, error));
      }
      if (normalized.job.status === "in_progress" || normalized.job.status === "queued") {
        const task = decodeOptionalTask(normalized.job.id);
        if (task) normalized = await pollImage(task.taskId, normalized, model.id, request, waitSeconds);
      }
      return successResult(normalized.job, normalized.inlineImages);
    },

    cheapbuddy_quote_video: async (args) => {
      assertPlainObject(args, "arguments");
      assertNoUnknownKeys(args, new Set(["model", "seconds", "ratio", "resolution", "has_reference"]));
      const model = await resolveModel(args.model, "video");
      const hasReference = args.has_reference === undefined ? false : optionalBoolean(args.has_reference, "has_reference");
      const normalized = normalizeH3Fields({ seconds: args.seconds, ratio: args.ratio, resolution: args.resolution, hasReference });
      const payload = await backend.quote(model.id, { seconds: normalized.seconds });
      return successResult(videoQuote(payload, model, normalized));
    },

    cheapbuddy_submit_video: async (args) => {
      assertPlainObject(args, "arguments");
      assertNoUnknownKeys(args, new Set(["model", "prompt", "seconds", "ratio", "resolution", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio", "images", "context_ir_enabled", "aigc_watermark", "idempotency_key"]));
      const model = await resolveModel(args.model, "video");
      const refs = normalizeVideoReferences(args);
      const fields = normalizeH3Fields({ seconds: args.seconds, ratio: args.ratio, resolution: args.resolution, hasReference: refs.hasReference });
      const prompt = requiredText(args.prompt, "prompt");
      const request = {
        model: model.id,
        prompt,
        seconds: fields.seconds,
        ratio: fields.ratio,
        resolution: fields.resolution,
        ...(refs.serialized ? { references: refs.serialized } : {}),
        ...(args.context_ir_enabled === undefined ? {} : { context_ir_enabled: optionalBoolean(args.context_ir_enabled, "context_ir_enabled") }),
        ...(args.aigc_watermark === undefined ? {} : { aigc_watermark: optionalBoolean(args.aigc_watermark, "aigc_watermark") }),
      };
      try {
        const response = await backend.createVideo({
          model: model.id, prompt, ...fields, ...refs.inputs,
          context_ir_enabled: optionalBoolean(args.context_ir_enabled, "context_ir_enabled"),
          aigc_watermark: optionalBoolean(args.aigc_watermark, "aigc_watermark"),
          idempotencyKey: normalizeIdempotencyKey(args.idempotency_key) || `cheapbuddy-media-${randomUUID()}`,
        });
        const normalized = normalizeVideoResponse(response, { backend, model: model.id, request });
        return successResult(normalized.job, normalized.inlineImages);
      } catch (error) {
        if (!error.ambiguous && error.code !== "accepted_unknown") throw error;
        return successResult(acceptedUnknown("video", model.id, request, error));
      }
    },

    cheapbuddy_get_media_job: async (args) => {
      assertPlainObject(args, "arguments");
      assertNoUnknownKeys(args, new Set(["job_id"]));
      const decoded = decodeJobId(args.job_id);
      const payload = decoded.kind === "image" ? await backend.getImageTask(decoded.taskId) : await backend.getVideoTask(decoded.taskId);
      const model = payload?.model || payload?.data?.model || payload?.task?.model || "unknown";
      const normalized = await normalizeQueriedJob(decoded.kind, payload, { backend, model, request: undefined });
      return successResult(normalized.job, normalized.inlineImages);
    },
  };

  return {
    async call(name, rawArgs = {}) {
      if (!TOOL_NAMES.includes(name)) throw validationError(`Unknown CheapBuddy Media MCP tool: ${name}.`);
      try {
        return await handlers[name](rawArgs);
      } catch (error) {
        return errorResult(error);
      }
    },
  };

  async function resolveModel(modelId, expectedType) {
    if (typeof modelId !== "string" || !modelId.trim() || modelId.length > 200) throw validationError("model is required and must be at most 200 characters.");
    let rows = await backend.listMediaModels();
    let model;
    try {
      model = findMediaModel(rows, modelId);
    } catch (error) {
      backend.invalidateCatalog();
      rows = await backend.listMediaModels({ refresh: true });
      model = findMediaModel(rows, modelId);
    }
    if (model.media_type !== expectedType) throw validationError(`Model ${modelId} is not a ${expectedType} model.`);
    return model;
  }

  async function pollImage(taskId, initial, model, request, requestedWaitSeconds) {
    const waitSeconds = requestedWaitSeconds === undefined ? 300 : Number(requestedWaitSeconds);
    if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 300) throw validationError("wait_seconds must be between 0 and 300.");
    const deadline = clock() + waitSeconds * 1000;
    let current = initial;
    const delays = [2000, 3000, 5000, 8000];
    let index = 0;
    while (clock() < deadline) {
      const serverDelay = Number(current.job.poll_after_ms);
      const fallbackDelay = delays[Math.min(index, delays.length - 1)];
      const delay = Number.isFinite(serverDelay) && serverDelay >= 0 ? Math.min(Math.max(serverDelay, 500), 10000) : Math.min(fallbackDelay, 10000);
      await wait(delay);
      const payload = await backend.getImageTask(taskId);
      current = await normalizeImageResponse(payload, { backend, model, request });
      if (["completed", "failed", "unknown"].includes(current.job.status)) return current;
      index += 1;
    }
    return {
      job: { ...current.job, status: current.job.status === "unknown" ? "unknown" : current.job.status, poll_after_ms: 2000 },
      inlineImages: current.inlineImages,
    };
  }
}

function imageQuote(payload, model, operation) {
  const metadata = payload?.cheapbuddy || {};
  const estimate = numberOrNull(metadata.estimated_amount_usd ?? metadata.estimated_amount ?? payload?.estimated_amount_usd);
  return {
    object: "media_quote", media_type: "image", model: model.id, operation,
    pricing_type: estimate === null ? "rate_card" : "estimate", estimated_amount: estimate, currency: "USD",
    rate_card: payload?.data || null,
    billing_note: "Final charge follows successful upstream usage; this quote does not reserve balance.",
  };
}

function videoQuote(payload, model, fields) {
  const estimate = numberOrNull(payload?.cheapbuddy?.reservation?.estimated_amount_usd);
  return {
    object: "media_quote", media_type: "video", model: model.id, seconds: fields.seconds, ratio: fields.ratio, resolution: fields.resolution,
    pricing_type: estimate === null ? "rate_card" : "estimate", estimated_amount: estimate, currency: "USD",
    rate_card: payload?.data || null, reservation: payload?.cheapbuddy?.reservation || null,
    billing_note: "Final charge follows successful upstream usage; this quote does not reserve balance.",
  };
}

function normalizeVideoReferences(args) {
  const single = ["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"];
  const inputs = {};
  const serialized = {};
  for (const field of single) {
    if (args[field] === undefined) continue;
    const kind = field.includes("video") ? "video" : field.includes("audio") ? "audio" : "image";
    inputs[field] = validateMediaInput(args[field], kind);
    serialized[field] = args[field];
  }
  const images = arrayOrEmpty(args.images, "images");
  if (images.length && single.some((name) => args[name] !== undefined && ["first_frame", "last_frame", "reference_image"].includes(name))) {
    throw validationError("Use images or named H3 image roles, not both.");
  }
  if (images.length > 3) throw validationError("images accepts at most three H3 image references.");
  if (images.length) {
    inputs.images = images.map((value) => validateMediaInput(value, "image"));
    serialized.images = images;
  }
  return { inputs, serialized: Object.keys(serialized).length ? serialized : null, hasReference: Object.keys(inputs).length > 0 };
}

function normalizeH3Fields({ seconds, ratio, resolution, hasReference }) {
  if (seconds !== undefined && typeof seconds !== "number") throw validationError("seconds must be a number.");
  if (ratio !== undefined && ratio !== "" && typeof ratio !== "string") throw validationError("ratio must be a string.");
  if (resolution !== undefined && typeof resolution !== "string") throw validationError("resolution must be a string.");
  const normalizedSeconds = seconds === undefined ? 6 : seconds;
  if (!Number.isInteger(normalizedSeconds) || normalizedSeconds < 4 || normalizedSeconds > 15) throw validationError("seconds must be an integer between 4 and 15.");
  const normalizedResolution = (resolution || "768P").toUpperCase();
  if (normalizedResolution !== "768P") throw validationError("resolution must be 768P.");
  const validRatios = new Set(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
  const normalizedRatio = ratio === undefined || ratio === "" ? (hasReference ? "adaptive" : undefined) : ratio;
  if (!normalizedRatio || (!validRatios.has(normalizedRatio) && !(hasReference && normalizedRatio === "adaptive"))) {
    throw validationError(hasReference ? "ratio must be one of the supported ratios or adaptive." : "ratio is required for text-to-video.");
  }
  return { seconds: normalizedSeconds, ratio: normalizedRatio, resolution: normalizedResolution };
}

function validateParameters(parameters, model) {
  if (parameters === undefined) return {};
  assertPlainObject(parameters, "parameters");
  const allowed = allowedParameterNames(model);
  for (const key of Object.keys(parameters)) if (!allowed.has(key)) throw validationError(`Unsupported parameter for ${model.id}: ${key}.`);
  return structuredClone(parameters);
}

function arrayOrEmpty(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw validationError(`${name} must be an array.`);
  return value;
}

function requiredText(value, name) {
  const text = optionalText(value, name);
  if (!text) throw validationError(`${name} is required.`);
  return text;
}

function optionalText(value, name) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 100000) throw validationError(`${name} must be a string.`);
  return value.trim();
}

function optionalBoolean(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw validationError(`${name} must be a boolean.`);
  return value;
}

function normalizeWaitSeconds(value) {
  if (value === undefined) return 300;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 300) {
    throw validationError("wait_seconds must be an integer between 0 and 300.");
  }
  return value;
}

function requireEnum(value, allowed, name) {
  if (!allowed.includes(value)) throw validationError(`${name} must be one of: ${allowed.join(", ")}.`);
  return value;
}

function acceptedUnknown(kind, model, request, error) {
  return {
    object: "media_job", id: null, media_type: kind, model, status: "unknown", accepted_unknown: true,
    request, media: [], usage: null, billing: { status: "pending_reconciliation" },
    error: { code: "accepted_unknown", message: "Relay may have accepted this task; query the provider-side task identity when available." },
    ...(error?.retryAfterMs === undefined ? {} : { poll_after_ms: error.retryAfterMs }),
  };
}

function decodeOptionalTask(id) {
  if (!id) return null;
  try { return decodeJobId(id); } catch { return null; }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeIdempotencyKey(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\r\n\u0000]/u.test(value)) {
    throw validationError("idempotency_key must be a non-empty safe string of at most 200 characters.");
  }
  return value.trim();
}

function successResult(value, inlineImages = []) {
  return {
    content: [
      { type: "text", text: JSON.stringify(value) },
      ...inlineImages,
    ],
    structuredContent: value,
  };
}

function errorResult(error) {
  const safe = publicError(error);
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: safe }) }], structuredContent: { error: safe } };
}

function imageQuoteSchema() {
  return { type: "object", additionalProperties: false, required: ["model"], properties: { model: { type: "string" }, operation: { type: "string", enum: ["generate", "edit", "variation"], default: "generate" } } };
}

function imageGenerateSchema() {
  return {
    type: "object", additionalProperties: false, required: ["model", "operation"],
    properties: {
      model: { type: "string" }, operation: { type: "string", enum: ["generate", "edit", "variation"] }, prompt: { type: "string" },
      images: { type: "array", items: mediaInputSchema() }, mask: mediaInputSchema(), parameters: { type: "object", additionalProperties: true },
      wait_seconds: { type: "integer", minimum: 0, maximum: 300, default: 300 }, idempotency_key: { type: "string", maxLength: 200 },
    },
  };
}

function videoQuoteSchema() {
  return { type: "object", additionalProperties: false, required: ["model"], properties: { model: { type: "string" }, seconds: { type: "integer", minimum: 4, maximum: 15, default: 6 }, ratio: { type: "string" }, resolution: { type: "string", enum: ["768P"], default: "768P" }, has_reference: { type: "boolean", default: false } } };
}

function videoSubmitSchema() {
  return {
    type: "object", additionalProperties: false, required: ["model", "prompt"],
    properties: {
      model: { type: "string" }, prompt: { type: "string" }, seconds: { type: "integer", minimum: 4, maximum: 15, default: 6 },
      ratio: { type: "string", enum: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"] }, resolution: { type: "string", enum: ["768P"], default: "768P" },
      first_frame: mediaInputSchema(), last_frame: mediaInputSchema(), reference_image: mediaInputSchema(), reference_video: mediaInputSchema(), reference_audio: mediaInputSchema(),
      images: { type: "array", maxItems: 3, items: mediaInputSchema() }, context_ir_enabled: { type: "boolean" }, aigc_watermark: { type: "boolean" }, idempotency_key: { type: "string", maxLength: 200 },
    },
  };
}

function mediaInputSchema() {
  return { type: "object", additionalProperties: false, minProperties: 1, maxProperties: 1, properties: { path: { type: "string" }, url: { type: "string", format: "uri", pattern: "^https://" } } };
}

export { normalizeH3Fields, normalizeVideoReferences, validateParameters, successResult, errorResult };
