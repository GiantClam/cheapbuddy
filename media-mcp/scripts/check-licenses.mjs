import { readFile } from "node:fs/promises";
import path from "node:path";

const lockPath = path.resolve("package-lock.json");
const packageManifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const missing = [];

if (!packageManifest.license && !packageManifest.licenses) missing.push("package.json (project license metadata unavailable)");

for (const packagePath of Object.keys(lock.packages || {})) {
  if (!packagePath.startsWith("node_modules/") || packagePath.includes("/node_modules/")) continue;
  const manifestPath = path.join(process.cwd(), packagePath, "package.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!manifest.license && !manifest.licenses) missing.push(packagePath);
  } catch {
    missing.push(`${packagePath} (manifest unavailable)`);
  }
}

if (missing.length) {
  process.stderr.write(`Dependencies without license metadata:\n${missing.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("All installed production dependencies expose license metadata.\n");
}
