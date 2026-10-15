import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

test("stdio CLI keeps diagnostics off stdout and completes MCP initialization", async () => {
  const child = spawn(process.execPath, ["src/cli.mjs"], {
    cwd: root,
    env: { ...process.env, CHEAPBUDDY_API_KEY: "cb_test_stdio" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdio-test", version: "1" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  const output = await waitForOutput(child, stdout, 5000, /"id":2/);
  child.kill();
  assert.equal(stderr.join(""), "");
  const messages = output.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const listed = messages.find((message) => message.id === 2);
  assert.equal(listed.result.tools.length, 6);
});

test("stdio CLI fails locally when the API key is missing", async () => {
  const environment = { ...process.env };
  delete environment.CHEAPBUDDY_API_KEY;
  const child = spawn(process.execPath, ["src/cli.mjs"], { cwd: root, env: environment, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Timed out waiting for missing-key failure.")); }, 3000);
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /configuration_error/);
  assert.match(stderr, /CHEAPBUDDY_API_KEY/);
});

test("stdio CLI prints help without requiring an API key", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage: cheapbuddy-media-mcp/);
  assert.match(result.stdout, /-h, --help/);
  assert.match(result.stdout, /-v, --version/);
  assert.equal(result.stderr, "");
});

test("stdio CLI prints its version without requiring an API key", async () => {
  const result = await runCli(["-v"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(result.stderr, "");
});

async function runCli(args) {
  const environment = { ...process.env };
  delete environment.CHEAPBUDDY_API_KEY;
  const child = spawn(process.execPath, ["src/cli.mjs", ...args], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out waiting for ${args.join(" ")} output.`)); }, 3000);
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  return { exitCode, stdout, stderr };
}

async function waitForOutput(child, chunks, timeoutMs, pattern) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const output = chunks.join("");
    if (pattern.test(output)) return output;
    if (child.exitCode !== null) throw new Error(`stdio process exited with ${child.exitCode}: ${output}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill();
  throw new Error("Timed out waiting for MCP stdio response.");
}
