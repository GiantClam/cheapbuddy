#!/usr/bin/env node

import { createRequire } from "node:module";
import { publicError } from "./errors.mjs";
import { startStdioServer } from "./server.mjs";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const HELP = `Usage: cheapbuddy-media-mcp [options]

Start the CheapBuddy Media MCP server over stdio.

Options:
  -h, --help       Show this help message and exit.
  -v, --version    Show the package version and exit.

Environment:
  CHEAPBUDDY_API_KEY   Required when starting the MCP server.
  CHEAPBUDDY_BASE_URL   Optional compatible CheapBuddy Relay URL.
`;

const args = process.argv.slice(2);

try {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
  } else if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${version}\n`);
  } else if (!String(process.env.CHEAPBUDDY_API_KEY || "").trim()) {
    const error = publicError(new Error("CHEAPBUDDY_API_KEY is required."));
    error.code = "configuration_error";
    error.message = "CHEAPBUDDY_API_KEY is required.";
    process.stderr.write(`${JSON.stringify({ error })}\n`);
    process.exitCode = 1;
  } else {
    await startStdioServer();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: publicError(error) })}\n`);
  process.exitCode = 1;
}
