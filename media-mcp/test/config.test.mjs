import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("client smoke-test configurations use environment-only authentication", async () => {
  const claude = JSON.parse(await readFile(path.join(root, "examples", "claude-code.mcp.json"), "utf8"));
  const claudeDesktop = JSON.parse(await readFile(path.join(root, "examples", "claude-desktop.mcp.json"), "utf8"));
  const opencode = JSON.parse(await readFile(path.join(root, "examples", "opencode.json"), "utf8"));
  assert.deepEqual(claude.mcpServers["cheapbuddy-media"].args, ["--yes", "--registry=https://registry.npmjs.org", "@cheapbuddy/media-mcp@0.1.3"]);
  assert.equal(claude.mcpServers["cheapbuddy-media"].env.CHEAPBUDDY_API_KEY, "${CHEAPBUDDY_API_KEY}");
  assert.deepEqual(claudeDesktop.mcpServers["cheapbuddy-media"].args, ["--yes", "--registry=https://registry.npmjs.org", "@cheapbuddy/media-mcp@0.1.3"]);
  assert.equal(claudeDesktop.mcpServers["cheapbuddy-media"].env.CHEAPBUDDY_API_KEY, "REPLACE_WITH_YOUR_CHEAPBUDDY_API_KEY");
  assert.deepEqual(opencode.mcp["cheapbuddy-media"].command, ["npx", "--yes", "--registry=https://registry.npmjs.org", "@cheapbuddy/media-mcp@0.1.3"]);
  assert.equal(opencode.mcp["cheapbuddy-media"].environment.CHEAPBUDDY_API_KEY, "{env:CHEAPBUDDY_API_KEY}");
  const codex = await readFile(path.join(root, "examples", "codex.toml"), "utf8");
  assert.match(codex, /\[mcp_servers\.cheapbuddy_media\]/u);
  assert.match(codex, /CHEAPBUDDY_API_KEY\s*=\s*"\$\{CHEAPBUDDY_API_KEY\}"/u);
});

test("published CLI declares a Node shebang for Windows npm shims", async () => {
  const cli = await readFile(path.join(root, "src", "cli.mjs"), "utf8");
  assert.match(cli, /^#!\/usr\/bin\/env node\r?\n/u);
});
