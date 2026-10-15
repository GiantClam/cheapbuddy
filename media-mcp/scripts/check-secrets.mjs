import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const forbidden = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bsk-(?:ant|proj|live)-[A-Za-z0-9_-]{20,}/u,
  /\bAIza[0-9A-Za-z_-]{30,}/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{32,}/u,
];
const ignored = new Set(["node_modules", ".git", "package-lock.json"]);
const findings = [];

await visit(root);
if (findings.length) {
  for (const finding of findings) console.error(finding);
  process.exitCode = 1;
} else {
  console.log("No high-confidence secrets found in media-mcp source files.");
}

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(target);
      continue;
    }
    if (!/\.(?:mjs|json|toml|md)$/u.test(entry.name)) continue;
    const text = await readFile(target, "utf8");
    if (forbidden.some((pattern) => pattern.test(text))) findings.push(`Potential secret in ${path.relative(root, target)}`);
  }
}
