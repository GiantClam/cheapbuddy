import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CheapBuddyRelayBackend } from "../src/backend.mjs";
import { createMediaMcpServer } from "../src/server.mjs";
import { createToolHandlers, TOOL_NAMES } from "../src/tools.mjs";
import { mediaModelRows, normalizeModel } from "../src/catalog.mjs";
import { decodeJobId, encodeJobId } from "../src/job-id.mjs";
import { loadLocalMedia, validateHttpsUrl } from "../src/media-input.mjs";
import { CheapBuddyHttpClient } from "../src/http.mjs";
import { normalizeVideoResponse } from "../src/normalize.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("job IDs are stateless, opaque, and round-trip", () => {
  const id = encodeJobId("video", "task/with?signature=abc");
  assert.match(id, /^vid_task_[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeJobId(id), { kind: "video", taskId: "task/with?signature=abc" });
  assert.throws(() => decodeJobId("task_123"), /MCP-generated/);
});

test("media input validation preserves signed HTTPS URLs and rejects private hosts", () => {
  const signed = validateHttpsUrl("https://cdn.example.test/video.mp4?X-Amz-Signature=abc&expires=123");
  assert.equal(signed, "https://cdn.example.test/video.mp4?X-Amz-Signature=abc&expires=123");
  assert.throws(() => validateHttpsUrl("http://cdn.example.test/video.mp4"), /HTTPS/);
  assert.throws(() => validateHttpsUrl("https://127.0.0.1/file"), /private/);
  assert.throws(() => validateHttpsUrl("https://user:pass@cdn.example.test/file"), /credentials/);
});

test("local media accepts regular PNG files and rejects directories", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cheapbuddy-media-") );
  const file = path.join(directory, "input.png");
  await writeFile(file, PNG);
  try {
    const loaded = await loadLocalMedia({ path: file }, "image");
    assert.equal(loaded.mimeType, "image/png");
    assert.deepEqual(loaded.bytes, PNG);
    await assert.rejects(() => loadLocalMedia({ path: directory }, "image"), /regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("model catalog exposes conservative H3 and image capabilities", () => {
  const h3 = normalizeModel({ id: "MiniMax-H3", type: "video", capabilities: ["text_to_video"] });
  assert.equal(h3.media_type, "video");
  assert.equal(h3.parameter_schema.resolution.default, "768P");
  const image = normalizeModel({ id: "grok-imagine-image-2.0", type: "image", capabilities: ["text_to_image", "image_edit", "variation"], parameter_schema: { images: { type: "array", maxItems: 3 }, quality: { type: "string" } } });
  assert.equal(image.max_images, 3);
  assert.deepEqual(image.operations, ["generate", "edit", "variation"]);
});

test("model catalog excludes non-media rows instead of returning null entries", () => {
  const rows = mediaModelRows({ data: [
    { id: "gpt-text", type: "text", capabilities: ["chat"] },
    { id: "MiniMax-H3", type: "video", capabilities: ["text_to_video"] },
  ] });
  assert.deepEqual(rows.map((row) => row.id), ["MiniMax-H3"]);
});

test("HTTP client authenticates, bounds retry, and honors Retry-After", async () => {
  let calls = 0;
  const delays = [];
  const client = new CheapBuddyHttpClient({
    apiKey: "cb_test_secret",
    baseUrl: "https://relay.example.test",
    sleep: async (ms) => delays.push(ms),
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(init.headers.get("Authorization"), "Bearer cb_test_secret");
      if (calls === 1) return new Response(JSON.stringify({ error: { type: "rate_limit_error", message: "slow down" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "1" } });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const payload = await client.readJson("GET", "/v1/models");
  assert.deepEqual(payload, { data: [] });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
});

test("model catalog cache expires after 60 seconds and refreshes explicitly", async () => {
  let current = 0;
  let calls = 0;
  const backend = new CheapBuddyRelayBackend({
    apiKey: "cb_test",
    baseUrl: "https://relay.example.test",
    now: () => current,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: [{ id: "MiniMax-H3", type: "video", capabilities: ["text_to_video"] }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  await backend.listMediaModels();
  await backend.listMediaModels();
  assert.equal(calls, 1);
  current = 60001;
  await backend.listMediaModels();
  assert.equal(calls, 2);
  await backend.listMediaModels({ refresh: true });
  assert.equal(calls, 3);
});

test("read authentication failures are never retried", async () => {
  let calls = 0;
  const client = new CheapBuddyHttpClient({
    apiKey: "cb_test",
    baseUrl: "https://relay.example.test",
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { type: "authentication_error", message: "Bearer cb_test must not escape" } }), { status: 401, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(() => client.readJson("GET", "/v1/models"), (error) => error.code === "authentication_error");
  assert.equal(calls, 1);
});

test("Relay backend builds JSON H3 requests and multipart local requests", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ id: "video-task-1", status: "queued", model: "MiniMax-H3" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new CheapBuddyRelayBackend({ apiKey: "cb_test", baseUrl: "https://relay.example.test", fetchImpl });
  await client.createVideo({ model: "MiniMax-H3", prompt: "a lighthouse", seconds: 6, ratio: "16:9", resolution: "768P", first_frame: { url: "https://cdn.example.test/frame.png" } });
  assert.equal(seen[0].init.headers.get("Idempotency-Key").startsWith("cheapbuddy-media-"), true);
  const json = JSON.parse(seen[0].init.body);
  assert.equal(json.first_frame, "https://cdn.example.test/frame.png");
  const temp = await mkdtemp(path.join(os.tmpdir(), "cheapbuddy-media-") );
  const file = path.join(temp, "frame.png");
  await writeFile(file, PNG);
  try {
    await client.createVideo({ model: "MiniMax-H3", prompt: "a lighthouse", seconds: 6, ratio: "16:9", resolution: "768P", first_frame: { path: file } });
    assert.equal(seen[1].init.body instanceof FormData, true);
    const entries = [...seen[1].init.body.entries()];
    assert.equal(entries.find(([key]) => key === "model")[1], "MiniMax-H3");
    assert.equal(entries.find(([key]) => key === "first_frame")[1] instanceof Blob, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("mixed image inputs use bounded JSON data URLs without downloading remote media", async () => {
  const seen = [];
  const backend = new CheapBuddyRelayBackend({
    apiKey: "cb_test", baseUrl: "https://relay.example.test",
    fetchImpl: async (_url, init) => {
      seen.push(init);
      return new Response(JSON.stringify({ data: [{ url: "https://cdn.example.test/out.png" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "cheapbuddy-media-") );
  const file = path.join(directory, "local.png");
  await writeFile(file, PNG);
  try {
    await backend.createImage({ model: "grok-imagine-image-2.0", operation: "edit", prompt: "blend", images: [{ path: file }, { url: "https://cdn.example.test/remote.png" }] });
    assert.equal(seen[0].body instanceof FormData, false);
    const body = JSON.parse(seen[0].body);
    assert.equal(body.images[1], "https://cdn.example.test/remote.png");
    assert.match(body.images[0], /^data:image\/png;base64,/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("multipart H3 maps all reference roles to plugin-supported field names", async () => {
  const seen = [];
  const backend = new CheapBuddyRelayBackend({
    apiKey: "cb_test", baseUrl: "https://relay.example.test",
    fetchImpl: async (_url, init) => {
      seen.push(init);
      return new Response(JSON.stringify({ id: "video-task-all", status: "queued" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), "cheapbuddy-media-") );
  const image = path.join(directory, "frame.png");
  const video = path.join(directory, "reference.mp4");
  const audio = path.join(directory, "reference.wav");
  // Minimal valid signatures are sufficient for the boundary validator.
  await writeFile(image, PNG);
  await writeFile(video, Buffer.from([0, 0, 0, 0, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]));
  await writeFile(audio, Buffer.from("RIFF0000WAVE", "ascii"));
  try {
    await backend.createVideo({ model: "MiniMax-H3", prompt: "x", seconds: 6, ratio: "adaptive", resolution: "768P", images: [{ path: image }], reference_video: { path: video }, reference_audio: { path: audio } });
    const names = [...seen[0].body.keys()];
    assert.deepEqual(names.filter((name) => ["first_frame", "reference_video", "reference_audio"].includes(name)).sort(), ["first_frame", "reference_video", "reference_audio"].sort());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function fakeBackend() {
  const calls = [];
  const backend = {
    calls,
    async listMediaModels() {
      return [
        { id: "grok-imagine-image-2.0", media_type: "image", operations: ["generate", "edit", "variation"], max_images: 3, parameter_schema: { quality: { type: "string" } } },
        { id: "MiniMax-H3", media_type: "video", capabilities: ["text_to_video", "image_to_video", "reference_to_video"], parameter_schema: {} },
      ];
    },
    invalidateCatalog() {},
    async quote(model, query) { calls.push({ method: "quote", model, query }); return { data: [{ model_name: model }], cheapbuddy: { billing_mode: "account_balance" } }; },
    async createImage(request) { calls.push({ method: "createImage", request }); return { data: [{ b64_json: PNG.toString("base64") }], usage: { output_images: 1 } }; },
    async uploadResult() { return { url: "https://relay.example.test/v1/media/result", expires_at: "2026-10-11T00:00:00Z" }; },
    async createVideo(request) { calls.push({ method: "createVideo", request }); return { id: "h3-task-1", status: "queued", model: request.model }; },
    async getImageTask() { return { status: "completed", data: [{ url: "https://cdn.example.test/result.png" }] }; },
    async getVideoTask() { return { id: "h3-task-1", status: "completed", content_url: "https://relay.example.test/v1/videos/h3-task-1/content" }; },
    videoContentUrl(id) { return `https://relay.example.test/v1/videos/${id}/content`; },
  };
  return backend;
}

test("tool handlers enforce mask semantics and submit H3 without confirmation", async () => {
  const backend = fakeBackend();
  const handlers = createToolHandlers({ backend, sleep: async () => {}, now: () => 0 });
  const invalid = await handlers.call("cheapbuddy_generate_image", { model: "grok-imagine-image-2.0", operation: "generate", prompt: "x", mask: { url: "https://cdn.example.test/mask.png" } });
  assert.equal(invalid.isError, true);
  assert.equal(backend.calls.some((call) => call.method === "createImage"), false);
  const image = await handlers.call("cheapbuddy_generate_image", { model: "grok-imagine-image-2.0", operation: "generate", prompt: "x" });
  const imagePayload = JSON.parse(image.content[0].text);
  assert.equal(imagePayload.status, "completed");
  assert.equal(image.content.some((item) => item.type === "image"), true);
  const video = await handlers.call("cheapbuddy_submit_video", { model: "MiniMax-H3", prompt: "x", ratio: "16:9" });
  const videoPayload = JSON.parse(video.content[0].text);
  assert.equal(videoPayload.status, "queued");
  assert.equal(videoPayload.request.seconds, 6);
  assert.equal(videoPayload.request.resolution, "768P");
  assert.match(videoPayload.id, /^vid_task_/);
  assert.equal(backend.calls.find((call) => call.method === "createVideo").request.ratio, "16:9");
});

test("H3 named and local reference inputs survive validation and remain non-blocking", async () => {
  const backend = fakeBackend();
  const handlers = createToolHandlers({ backend, sleep: async () => {}, now: () => 0 });
  const directory = await mkdtemp(path.join(os.tmpdir(), "cheapbuddy-media-") );
  const file = path.join(directory, "frame.png");
  await writeFile(file, PNG);
  try {
    const result = await handlers.call("cheapbuddy_submit_video", {
      model: "MiniMax-H3", prompt: "a lighthouse", first_frame: { path: file }, ratio: "16:9",
    });
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.status, "queued");
    const call = backend.calls.find((item) => item.method === "createVideo");
    assert.equal(call.request.first_frame.kind, "path");
    const remote = await handlers.call("cheapbuddy_submit_video", {
      model: "MiniMax-H3", prompt: "a lighthouse", reference_video: { url: "https://cdn.example.test/ref.mp4" },
    });
    const remotePayload = JSON.parse(remote.content[0].text);
    assert.equal(remotePayload.request.ratio, "adaptive");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("image processing polls with bounded backoff and returns a resumable result", async () => {
  let current = 0;
  let queries = 0;
  const backend = {
    async listMediaModels() { return [{ id: "grok-imagine-image-2.0", media_type: "image", operations: ["generate"], max_images: 1, parameter_schema: {} }]; },
    invalidateCatalog() {},
    async createImage() { return { id: "image-task-1", status: "processing" }; },
    async getImageTask() {
      queries += 1;
      return queries < 2 ? { id: "image-task-1", status: "processing", poll_after_ms: 3000 } : { id: "image-task-1", status: "completed", data: [{ url: "https://cdn.example.test/result.png" }] };
    },
    async uploadResult() { throw new Error("not expected"); },
  };
  const delays = [];
  const handlers = createToolHandlers({ backend, now: () => current, sleep: async (ms) => { delays.push(ms); current += ms; } });
  const result = await handlers.call("cheapbuddy_generate_image", { model: "grok-imagine-image-2.0", operation: "generate", prompt: "x" });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.status, "completed");
  assert.deepEqual(delays, [2000, 3000]);
  assert.equal(queries, 2);
});

test("a fresh backend resolves a stateless video job ID without local storage", async () => {
  const calls = [];
  const first = new CheapBuddyRelayBackend({ apiKey: "cb_test", baseUrl: "https://relay.example.test", fetchImpl: async () => new Response(JSON.stringify({ id: "task-restart", status: "queued" }), { status: 200, headers: { "content-type": "application/json" } }) });
  const id = encodeJobId("video", "task-restart");
  const second = new CheapBuddyRelayBackend({
    apiKey: "cb_test", baseUrl: "https://relay.example.test",
    fetchImpl: async (url) => { calls.push(url); return new Response(JSON.stringify({ id: "task-restart", status: "completed" }), { status: 200, headers: { "content-type": "application/json" } }); },
  });
  void first; // Keep the first instance intentionally unused: no state is shared.
  const payload = await second.getVideoTask(decodeJobId(id).taskId);
  assert.equal(payload.id, "task-restart");
  assert.equal(calls[0], "https://relay.example.test/v1/videos/task-restart");
});

test("completed video jobs use a Relay capability download URL", async () => {
  const calls = [];
  const backend = new CheapBuddyRelayBackend({
    apiKey: "cb_test", baseUrl: "https://relay.example.test",
    fetchImpl: async (url) => {
      calls.push(url);
      const payload = url.endsWith("/download-url")
        ? { object: "video_download", url: "https://relay.example.test/v1/videos/task-cap/content?download_token=opaque", expires_at: "2026-10-15T01:00:00Z" }
        : { id: "task-cap", status: "completed" };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const payload = await backend.getVideoTask("task-cap");
  const normalized = normalizeVideoResponse(payload, { backend, model: "MiniMax-H3" });
  assert.equal(normalized.job.media[0].url, "https://relay.example.test/v1/videos/task-cap/content?download_token=opaque");
  assert.equal(normalized.job.media[0].requires_auth, undefined);
  assert.equal(calls.length, 2);
});

test("MCP protocol exposes exactly six tools", async () => {
  const backend = fakeBackend();
  const { server } = createMediaMcpServer({ backend });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(client.getServerVersion()?.version, packageJson.version);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name), TOOL_NAMES);
  const result = await client.callTool({ name: "cheapbuddy_list_media_models", arguments: {} });
  assert.equal(result.isError, undefined);
  await client.close();
  await server.close();
});
