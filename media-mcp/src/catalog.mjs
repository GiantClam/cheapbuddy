import { validationError } from "./errors.mjs";

const IMAGE_CAPABILITIES = new Set(["text_to_image", "image_edit", "variation", "image_generation", "image_editing"]);
const VIDEO_CAPABILITIES = new Set(["text_to_video", "image_to_video", "reference_to_video", "video_generation", "openai-video"]);

export function mediaModelRows(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : (payload?.id ? [payload] : []);
  return rows
    .filter((row) => row && typeof row === "object" && typeof row.id === "string")
    .map(normalizeModel)
    .filter(Boolean);
}

export function normalizeModel(row) {
  const id = String(row.id).trim();
  const type = String(row.type || "").toLowerCase();
  const capabilities = toStringArray(row.capabilities);
  const endpoints = toStringArray(row.supported_endpoint_types);
  const isH3 = id === "MiniMax-H3";
  const isImage = type.includes("image") || capabilities.some((item) => IMAGE_CAPABILITIES.has(item)) || endpoints.includes("image-generation");
  const isVideo = type.includes("video") || capabilities.some((item) => VIDEO_CAPABILITIES.has(item)) || endpoints.includes("openai-video") || isH3;
  if (!isImage && !isVideo) return null;
  const parameterSchema = row.parameter_schema && typeof row.parameter_schema === "object" && !Array.isArray(row.parameter_schema)
    ? structuredClone(row.parameter_schema) : {};
  if (isH3) applyH3Schema(parameterSchema);
  if (id === "grok-imagine-image-2.0" && !parameterSchema.images) {
    parameterSchema.images = { type: "array", minItems: 1, maxItems: 4, optional: true, description: "One or more source images for edit/variation." };
  }
  const operations = isImage ? imageOperations(capabilities, parameterSchema) : [];
  const maxImages = maxImageCount(parameterSchema);
  return {
    id,
    object: row.object || "model",
    owned_by: row.owned_by || "cheapbuddy",
    media_type: isVideo ? "video" : "image",
    type: isVideo ? "video" : "image",
    capabilities: capabilities.length ? capabilities : (isH3 ? ["text_to_video", "image_to_video", "reference_to_video"] : ["text_to_image"]),
    operations,
    parameter_schema: parameterSchema,
    ...(maxImages ? { max_images: maxImages } : {}),
  };
}

export function findMediaModel(rows, modelId) {
  const model = rows.find((item) => item.id === modelId);
  if (!model) throw validationError(`Media model is not visible for this API key: ${modelId}.`, { model: modelId });
  return model;
}

export function imageOperations(capabilities, schema = {}) {
  const result = [];
  if (capabilities.includes("text_to_image") || capabilities.includes("image_generation") || !capabilities.length) result.push("generate");
  if (capabilities.includes("image_edit") || capabilities.includes("image_editing")) result.push("edit");
  if (capabilities.includes("variation")) result.push("variation");
  if (!result.length && Object.keys(schema).some((key) => ["image", "images", "mask"].includes(key))) result.push("edit");
  return [...new Set(result)];
}

export function modelAllowsOperation(model, operation) {
  return model.media_type === "image" && model.operations.includes(operation);
}

export function allowedParameterNames(model) {
  return new Set(Object.keys(model.parameter_schema || {}).filter((key) => !MEDIA_PARAMETER_NAMES.has(key)));
}

export function schemaForTool(model) {
  const schema = {};
  for (const [name, rule] of Object.entries(model.parameter_schema || {})) {
    if (MEDIA_PARAMETER_NAMES.has(name)) continue;
    schema[name] = structuredClone(rule);
  }
  return schema;
}

export function maxImageCount(schema) {
  for (const name of ["images", "image"]) {
    const rule = schema?.[name];
    const maximum = Number(rule?.maximum ?? rule?.maxItems);
    if (Number.isInteger(maximum) && maximum > 0 && maximum <= 128) return maximum;
  }
  return undefined;
}

export function isReferenceVideoRequest(request) {
  return Boolean(request.first_frame || request.last_frame || request.reference_image || request.reference_video || request.reference_audio || request.images?.length);
}

export function applyH3Schema(schema) {
  const defaults = {
    seconds: { type: "integer", minimum: 4, maximum: 15, default: 6, optional: true },
    duration: { type: "integer", minimum: 4, maximum: 15, default: 6, optional: true },
    ratio: { type: "string", options: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"], optional: true },
    resolution: { type: "string", options: ["768P"], default: "768P", optional: true },
    first_frame: { type: "image", optional: true },
    last_frame: { type: "image", optional: true },
    reference_image: { type: "image", optional: true },
    reference_video: { type: "video", optional: true },
    reference_audio: { type: "audio", optional: true },
  };
  for (const [key, value] of Object.entries(defaults)) if (!schema[key]) schema[key] = value;
  return schema;
}

export function toStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [];
}

const MEDIA_PARAMETER_NAMES = new Set([
  "model", "prompt", "image", "images", "mask", "first_frame", "last_frame", "reference_image", "reference_video", "reference_audio",
  "seconds", "duration", "ratio", "resolution", "size", "content", "input", "generation_type", "idempotency_key",
]);
