import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CheapBuddyRelayBackend } from "./backend.mjs";
import { createToolHandlers, toolDefinitions } from "./tools.mjs";

export function createMediaMcpServer(options = {}) {
  const backend = options.backend || new CheapBuddyRelayBackend(options);
  const handlers = options.handlers || createToolHandlers({ backend, sleep: options.sleep, now: options.now });
  const server = new Server(
    { name: "cheapbuddy-media-mcp", version: options.version || "0.1.1" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions: "CheapBuddy media tools use account balance directly. Quotes are optional and no budget or confirmation step is implemented.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions() }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => handlers.call(request.params.name, request.params.arguments || {}));
  return { server, backend, handlers };
}

export async function startStdioServer(options = {}) {
  const { server } = createMediaMcpServer(options);
  const transport = options.transport || new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
}
