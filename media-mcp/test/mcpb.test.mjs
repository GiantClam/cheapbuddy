import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("Claude Desktop MCPB manifest declares secure configuration and all runtime tools", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, "0.3");
  assert.equal(manifest.name, "cheapbuddy-media");
  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.entry_point, "src/cli.mjs");
  assert.equal(manifest.server.mcp_config.env.CHEAPBUDDY_API_KEY, "${user_config.api_key}");
  assert.equal(manifest.user_config.api_key.sensitive, true);
  assert.equal(manifest.user_config.api_key.required, true);
  assert.equal(manifest.user_config.base_url.default, "https://api.cheapbuddy.cc/v1");
  assert.deepEqual(manifest.tools.map(({ name }) => name), [
    "cheapbuddy_list_media_models",
    "cheapbuddy_quote_image",
    "cheapbuddy_quote_video",
    "cheapbuddy_generate_image",
    "cheapbuddy_submit_video",
    "cheapbuddy_get_media_job",
  ]);
});
