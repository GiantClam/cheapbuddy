import { validationError } from "./errors.mjs";

const PREFIXES = Object.freeze({ image: "img_task_", video: "vid_task_" });

export function encodeJobId(kind, taskId) {
  const prefix = PREFIXES[kind];
  const value = String(taskId ?? "").trim();
  if (!prefix || !value || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("Relay returned an invalid task identity.");
  }
  return prefix + Buffer.from(value, "utf8").toString("base64url");
}

export function decodeJobId(value) {
  const input = String(value ?? "");
  const entry = Object.entries(PREFIXES).find(([, prefix]) => input.startsWith(prefix));
  if (!entry) throw validationError("job_id must be an MCP-generated media job ID.");
  const [kind, prefix] = entry;
  const encoded = input.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 700) {
    throw validationError("job_id is invalid.");
  }
  let taskId;
  try {
    taskId = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    throw validationError("job_id is invalid.");
  }
  if (!taskId || taskId.length > 512 || /[\u0000-\u001f\u007f]/u.test(taskId) || Buffer.from(taskId, "utf8").toString("base64url") !== encoded) {
    throw validationError("job_id is invalid.");
  }
  return { kind, taskId };
}
