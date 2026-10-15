import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { validationError } from "./errors.mjs";

export const MEDIA_LIMITS = Object.freeze({
  image: { maxBytes: 30 * 1024 * 1024, aggregateBytes: 60 * 1024 * 1024 },
  video: { maxBytes: 50 * 1024 * 1024, aggregateBytes: 60 * 1024 * 1024 },
  audio: { maxBytes: 15 * 1024 * 1024, aggregateBytes: 60 * 1024 * 1024 },
});

const EXTENSIONS = Object.freeze({
  ".png": ["image/png", "image"],
  ".jpg": ["image/jpeg", "image"],
  ".jpeg": ["image/jpeg", "image"],
  ".webp": ["image/webp", "image"],
  ".gif": ["image/gif", "image"],
  ".heic": ["image/heic", "image"],
  ".heif": ["image/heif", "image"],
  ".mp4": ["video/mp4", "video"],
  ".m4v": ["video/mp4", "video"],
  ".mov": ["video/quicktime", "video"],
  ".webm": ["video/webm", "video"],
  ".wav": ["audio/wav", "audio"],
  ".mp3": ["audio/mpeg", "audio"],
  ".m4a": ["audio/mp4", "audio"],
  ".aac": ["audio/aac", "audio"],
  ".ogg": ["audio/ogg", "audio"],
});

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data.ec2.internal",
]);

const FILE_IO_LIMIT = 4;
let activeFileReads = 0;
const pendingFileReads = [];

export function validateMediaInput(value, expectedKind, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(`${expectedKind} input must contain exactly one path or url.`);
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || (!keys.includes("path") && !keys.includes("url"))) {
    throw validationError(`${expectedKind} input must contain exactly one path or url.`);
  }
  if (value.path !== undefined) {
    if (typeof value.path !== "string" || value.path.length > 4096 || !path.isAbsolute(value.path)) {
      throw validationError("Local media paths must be absolute.");
    }
    return { kind: "path", path: value.path, expectedKind, ...options };
  }
  if (typeof value.url !== "string" || value.url.length > 8192) throw validationError("Media URL must be a string of at most 8192 characters.");
  return { kind: "url", url: validateHttpsUrl(value.url), expectedKind, ...options };
}

export function validateHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw validationError("Media URL is invalid.");
  }
  if (parsed.protocol !== "https:") throw validationError("Media URL must use HTTPS.");
  if (parsed.username || parsed.password) throw validationError("Media URL must not contain credentials.");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw validationError("Media URL points to a private or local host.");
  }
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw validationError("Media URL points to a private or metadata address.");
  }
  return parsed.toString();
}

export function isPrivateAddress(hostname) {
  const version = net.isIP(hostname);
  if (version === 4) {
    const parts = hostname.split(".").map(Number);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  if (version === 6) {
    const normalized = hostname.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return false;
}

export async function loadLocalMedia(input, expectedKind, options = {}) {
  if (input?.kind === "url" && input.expectedKind === expectedKind && typeof input.url === "string") return input;
  if (input?.kind === "file" && input.mediaKind === expectedKind && Buffer.isBuffer(input.bytes)) return input;
  if (input?.kind === "path" && input.expectedKind === expectedKind && typeof input.path === "string") input = { path: input.path };
  const validated = validateMediaInput(input, expectedKind, options);
  if (validated.kind === "url") return validated;
  await acquireFileSlot();
  try {
    const info = await lstat(validated.path).catch(() => {
      throw validationError("Local media file does not exist or is not accessible.");
    });
    if (info.isSymbolicLink()) throw validationError("Symbolic-link media inputs are not allowed.");
    if (!info.isFile()) throw validationError("Media input must be a regular file.");
    const extension = path.extname(validated.path).toLowerCase();
    const descriptor = EXTENSIONS[extension];
    if (!descriptor || descriptor[1] !== expectedKind) {
      throw validationError(`Unsupported ${expectedKind} file type.`);
    }
    const limits = MEDIA_LIMITS[expectedKind];
    if (info.size > limits.maxBytes) throw validationError(`${expectedKind} input exceeds the per-file size limit.`);
    const bytes = await readFile(validated.path);
    if (bytes.length !== info.size) throw validationError("Media file changed while it was being read.");
    if (!looksLikeKind(bytes, expectedKind, descriptor[0])) throw validationError("Media file content does not match its declared type.");
    return {
      kind: "file",
      path: validated.path,
      filename: path.basename(validated.path),
      mimeType: descriptor[0],
      mediaKind: expectedKind,
      bytes,
    };
  } finally {
    releaseFileSlot();
  }
}

export function validateAggregate(inputs, expectedKind) {
  const total = inputs.filter((item) => item?.kind === "file").reduce((sum, item) => sum + item.bytes.length, 0);
  if (total > MEDIA_LIMITS[expectedKind].aggregateBytes) throw validationError(`${expectedKind} inputs exceed the aggregate size limit.`);
}

function looksLikeKind(bytes, kind, mime) {
  if (bytes.length === 0) return false;
  if (kind === "image") {
    if (mime === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    if (mime === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
    return bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (kind === "video") {
    if (mime === "video/webm") return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    return bytes.length > 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (mime === "audio/wav") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE";
  if (mime === "audio/mpeg") return bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/ogg") return bytes.subarray(0, 4).toString("ascii") === "OggS";
  return bytes.subarray(4, 8).toString("ascii") === "ftyp" || bytes.subarray(0, 4).toString("ascii") === "ADIF";
}

export function inputValue(input) {
  if (input.kind === "url") return input.url;
  return input.bytes;
}

export function fileIoStats() {
  return { active: activeFileReads, pending: pendingFileReads.length, limit: FILE_IO_LIMIT };
}

async function acquireFileSlot() {
  if (activeFileReads < FILE_IO_LIMIT) {
    activeFileReads += 1;
    return;
  }
  await new Promise((resolve) => pendingFileReads.push(resolve));
  activeFileReads += 1;
}

function releaseFileSlot() {
  activeFileReads = Math.max(0, activeFileReads - 1);
  const next = pendingFileReads.shift();
  if (next) next();
}
