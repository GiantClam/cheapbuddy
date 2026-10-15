import { randomUUID } from "node:crypto";
import { CheapBuddyHttpClient } from "./http.mjs";
import { inputValue, loadLocalMedia, validateAggregate } from "./media-input.mjs";
import { validationError } from "./errors.mjs";
import { mediaModelRows } from "./catalog.mjs";

const IMAGE_STANDARD_FIELDS = new Set(["model", "prompt", "response_format"]);

export class CheapBuddyRelayBackend {
  constructor(options = {}) {
    this.http = options.http || new CheapBuddyHttpClient(options);
    this.now = options.now || (() => Date.now());
    this.catalogCache = null;
    this.catalogCachedAt = 0;
  }

  async listMediaModels({ refresh = false } = {}) {
    const fresh = this.catalogCache && this.now() - this.catalogCachedAt < 60000;
    if (!refresh && fresh) return structuredClone(this.catalogCache);
    const payload = await this.http.readJson("GET", "/v1/models");
    const rows = mediaModelRows(payload);
    this.catalogCache = rows;
    this.catalogCachedAt = this.now();
    return structuredClone(rows);
  }

  invalidateCatalog() {
    this.catalogCache = null;
    this.catalogCachedAt = 0;
  }

  async quote(model, query = {}) {
    const params = new URLSearchParams({ model });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    return this.http.readJson("GET", `/v1/pricing?${params.toString()}`);
  }

  async createImage({ model, operation, prompt, images = [], mask, parameters = {}, idempotencyKey }) {
    const preparedImages = await Promise.all(images.map((value) => loadLocalMedia(value, "image")));
    const preparedMask = mask ? await loadLocalMedia(mask, "image") : null;
    validateAggregate(preparedMask ? [...preparedImages, preparedMask] : preparedImages, "image");
    const fields = { model, ...(prompt ? { prompt } : {}), ...parameters };
    const path = operation === "generate" ? "/v1/images/generations" : operation === "edit" ? "/v1/images/edits" : "/v1/images/variations";
    const hasFile = preparedImages.some((item) => item.kind === "file") || preparedMask?.kind === "file";
    const hasRemote = preparedImages.some((item) => item.kind === "url") || preparedMask?.kind === "url";
    const key = idempotencyKey || `cheapbuddy-media-${randomUUID()}`;
    if (!hasFile || (hasFile && hasRemote)) {
      const values = preparedImages.map(imageJsonValue);
      const body = { ...fields };
      if (values.length) {
        if (values.length === 1) body.image = values[0];
        else body.images = values;
      }
      if (preparedMask) body.mask = imageJsonValue(preparedMask);
      if (Buffer.byteLength(JSON.stringify(body), "utf8") > 60 * 1024 * 1024) throw validationError("Image request exceeds the Relay aggregate request limit.");
      return this.http.request("POST", path, { body, json: true, idempotencyKey: key });
    }
    const form = new FormData();
    appendScalarFields(form, fields);
    for (const image of preparedImages) appendMediaPart(form, "image[]", image);
    if (preparedMask) appendMediaPart(form, "mask", preparedMask);
    return this.http.request("POST", path, { body: form, idempotencyKey: key });
  }

  async getImageTask(taskId) {
    return this.http.readJson("GET", `/v1/images/tasks/${encodeURIComponent(taskId)}`);
  }

  async createVideo({ model, prompt, seconds, ratio, resolution, first_frame, last_frame, reference_image, reference_video, reference_audio, images = [], context_ir_enabled, aigc_watermark, idempotencyKey }) {
    const normalized = await normalizeVideoInputs({ first_frame, last_frame, reference_image, reference_video, reference_audio, images });
    const values = {
      model,
      prompt,
      ...(seconds === undefined ? {} : { seconds }),
      ...(ratio === undefined ? {} : { ratio }),
      ...(resolution === undefined ? {} : { resolution }),
      ...(context_ir_enabled === undefined ? {} : { context_ir_enabled }),
      ...(aigc_watermark === undefined ? {} : { aigc_watermark }),
    };
    const hasFile = Object.values(normalized).some((item) => Array.isArray(item) ? item.some((entry) => entry?.kind === "file") : item?.kind === "file");
    const key = idempotencyKey || `cheapbuddy-media-${randomUUID()}`;
    if (!hasFile) {
      const body = { ...values };
      for (const [field, input] of Object.entries(normalized)) {
        if (Array.isArray(input)) {
          if (input.length) body.images = input.map(inputValue);
        } else if (input) {
          body[field] = inputValue(input);
        }
      }
      return this.http.request("POST", "/v1/videos", { body, json: true, idempotencyKey: key });
    }
    const form = new FormData();
    appendScalarFields(form, values);
    for (const [field, input] of Object.entries(normalized)) {
      if (Array.isArray(input)) {
        const fields = field === "images" ? ["first_frame", "last_frame", "reference_image"] : [];
        input.forEach((item, index) => appendMediaPart(form, fields[index] || "reference_image", item));
      } else if (input) {
        appendMediaPart(form, field, input);
      }
    }
    return this.http.request("POST", "/v1/videos", { body: form, idempotencyKey: key });
  }

  async getVideoTask(taskId) {
    return this.http.readJson("GET", `/v1/videos/${encodeURIComponent(taskId)}`);
  }

  videoContentUrl(taskId) {
    return this.http.buildUrl(`/v1/videos/${encodeURIComponent(taskId)}/content`);
  }

  isRelayUrl(value) {
    try {
      return new URL(value).origin === new URL(this.http.baseUrl).origin;
    } catch {
      return false;
    }
  }

  async uploadResult(bytes, mimeType) {
    return this.http.uploadMedia(bytes, mimeType);
  }
}

async function normalizeVideoInputs(values) {
  const result = {};
  const single = ["first_frame", "last_frame", "reference_image", "reference_video", "reference_audio"];
  for (const field of single) {
    if (!values[field]) continue;
    const kind = field.includes("video") ? "video" : field.includes("audio") ? "audio" : "image";
    result[field] = await loadLocalMedia(values[field], kind);
  }
  const images = Array.isArray(values.images) ? values.images : [];
  if (images.length > 3) throw validationError("images accepts at most three H3 image references.");
  if (images.length) {
    result.images = await Promise.all(images.map((value) => loadLocalMedia(value, "image")));
    validateAggregate(result.images, "image");
  }
  const all = Object.values(result).flatMap((item) => Array.isArray(item) ? item : [item]).filter(Boolean);
  for (const item of all) if (item.kind === "file") validateAggregate([item], item.mediaKind);
  const totalBytes = all.filter((item) => item.kind === "file").reduce((sum, item) => sum + item.bytes.length, 0);
  if (totalBytes > 60 * 1024 * 1024) throw validationError("H3 media inputs exceed the Relay aggregate request limit.");
  return result;
}

function appendScalarFields(form, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (key === "prompt" && !String(value).trim()) continue;
    form.append(key, typeof value === "boolean" ? String(value) : String(value));
  }
}

function appendMediaPart(form, field, input) {
  if (input.kind === "url") {
    form.append(field, input.url);
    return;
  }
  form.append(field, new Blob([input.bytes], { type: input.mimeType }), input.filename);
}

function imageJsonValue(input) {
  if (input.kind === "url") return input.url;
  return `data:${input.mimeType};base64,${input.bytes.toString("base64")}`;
}

export { normalizeVideoInputs, appendScalarFields, appendMediaPart, IMAGE_STANDARD_FIELDS };
