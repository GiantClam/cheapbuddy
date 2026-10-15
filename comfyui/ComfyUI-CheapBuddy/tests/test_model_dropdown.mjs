import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/js/cheapbuddy.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "");

function fixture(kind, fail = false) {
  let extension;
  const requests = [];
  const alerts = [];
  const storage = new Map();
  const model = {
    id: `${kind}-model`, type: kind,
    capabilities: { text: ["text_generation"], image: ["text_to_image"], video: ["text_to_video"] }[kind],
    parameter_schema: {},
  };
  vm.runInNewContext(source, {
    app: { registerExtension: (value) => { extension = value; } },
    api: { fetchApi: async (path, options) => {
      requests.push({ path, body: JSON.parse(options.body) });
      return { ok: !fail, json: async () => fail ? { error: "Rejected" }
        : path === "/cheapbuddy/models" ? { data: [model] } : model };
    } },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    crypto: webcrypto, TextEncoder, setTimeout: () => {}, alert: (value) => alerts.push(value),
  });
  const node = {
    comfyClass: { text: "CheapBuddyTextGenerate", image: "CheapBuddyImageGenerate", video: "CheapBuddyVideoGenerate" }[kind],
    widgets: [
      { name: "base_url", value: "https://example.invalid" },
      { name: "api_key", value: "YOUR_CHEAPBUDDY_API_KEY" },
      { name: "model", value: "Select model" },
      { name: "parameters_json", value: "{}" },
    ],
    addWidget(type, name, value, callback, options) {
      const widget = { type, name, value, callback, options };
      // Vue's store keeps the options supplied when the widget is created.
      if (name === "model") this.vueOptions = { ...options };
      this.widgets.push(widget);
      return widget;
    },
    setDirtyCanvas() {},
  };
  return { extension, node, requests, alerts };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail("Model discovery did not finish");
}

for (const kind of ["text", "image", "video"]) {
  test(`${kind}: Vue resolves an empty dropdown using the current credentials`, async () => {
    const { extension, node, requests } = fixture(kind);
    await extension.nodeCreated(node);
    extension.loadedGraphNode(node);
    assert.deepEqual(Array.from(node.vueOptions.values()), ["Select model"]);
    assert.equal(requests.length, 0, "Template credentials must not be sent");
    const keyWidget = node.widgets.find((w) => w.name === "api_key");
    keyWidget.value = "test-credential";
    keyWidget.callback(keyWidget.value);
    node.vueOptions.values(); // No canvas mouse or pointer hook.
    await until(() => node.vueOptions.values().includes(`${kind}-model`));
    assert.equal(requests.filter((r) => r.path === "/cheapbuddy/models").length, 1);
    assert.equal(requests[0].body.api_key, "test-credential");
    assert.equal(node.widgets.find((w) => w.name === "model").value, `${kind}-model`);
  });
}

test("Repeated Vue option reads do not retry a rejected key immediately", async () => {
  const { extension, node, requests, alerts } = fixture("text", true);
  await extension.nodeCreated(node);
  const keyWidget = node.widgets.find((w) => w.name === "api_key");
  keyWidget.value = "rejected-test-credential";
  keyWidget.callback(keyWidget.value);
  node.vueOptions.values();
  await until(() => alerts.length === 1);
  for (let count = 0; count < 10; count++) node.vueOptions.values();
  await delay(10);
  assert.equal(requests.length, 1);
  assert.deepEqual(Array.from(node.vueOptions.values()), ["Select model"]);
});
