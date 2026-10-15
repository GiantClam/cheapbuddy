# Media MCP release checklist

Automated implementation gates are covered by `npm test`, `npm run test:coverage`,
`npm run lint`, `npm run check:secrets`, `npm run check:licenses`,
`npm run audit`, and `npm run pack:check`. The checks
below require an operator with a valid CheapBuddy key and must not be run in a
CI job that can spend account balance unintentionally.

## Protocol and client smoke tests

1. Run the MCP Inspector against the packaged command and confirm `initialize`,
   `tools/list`, and one read-only model-list call. Confirm stdout contains only
   JSON-RPC frames and diagnostics stay on stderr.
2. Configure and launch the snippets in `examples/claude-desktop.mcp.json`,
   `examples/claude-code.mcp.json`, `examples/codex.toml`, and
   `examples/opencode.json` in Claude Desktop, Claude Code, Codex, and OpenCode
   respectively. Confirm each client discovers all six tools.
3. On Windows, verify the packed npm `.cmd` shim starts the CLI through Node
   and does not report `Connection closed`.
4. Run the packaged command with `--help` and `--version` without an API key;
   both must exit 0 with useful stdout and no stderr diagnostics.
5. Build and validate the Claude Desktop `.mcpb` bundle from `manifest.json`;
   confirm the sensitive `api_key` field is collected by the install UI and
   `tools/list` still exposes all six tools after installation.
6. Use a read-only model-list or pricing call before considering any paid
   write-tool probe.

## Opt-in paid probes

Run only against a deliberately funded test key and record the Relay request
ID, returned MCP job ID, billing status, and artifact expiry. Do not retry a
timed-out create with a new key.

- Image: one small generation, then reconcile the final Relay/NewAPI usage and
  temporary artifact URL.
- MiniMax-H3: one six-second 768P text request with a valid ratio, then query
  the `vid_task_...` ID until terminal and reconcile reservation, settlement,
  failure/success usage, and the Relay content URL.

The package intentionally has no budget or forced-confirmation layer. The
account balance and Relay reservation/settlement path are the spending
boundary.

## Verification record: 2026-10-11

- MCP Inspector `tools/list`: passed; exactly six tools returned.
- Codex live smoke: passed; discovered `grok-imagine-image-2.0` and `MiniMax-H3`.
- OpenCode live smoke: passed with the locally configured `tokfan/claude-opus-5-5`; discovered `grok-imagine-image-2.0` and `MiniMax-H3`.
- Claude Code live smoke: passed with the locally configured `tokfan/claude-opus-5-5`; it invoked `cheapbuddy_list_media_models` and returned `grok-imagine-image-2.0` and `MiniMax-H3`. Claude model credentials and `CHEAPBUDDY_API_KEY` were injected separately.
- Image paid probe: passed; one JPEG artifact fetched from Relay, same-day media usage USD 0.000076.
- H3 paid probe: passed; one 6-second 768P 16:9 MP4 artifact fetched from Relay, same-day media usage USD 0.092400.
- npm publication: passed on 2026-10-15; official Registry reports `@cheapbuddy/media-mcp@0.1.1` as the `latest` dist-tag. Verified `npx @cheapbuddy/media-mcp@0.1.1 --help`, `--version`, `initialize`, and `tools/list` (six tools).

All client, paid-task, and npm publication gates are complete. `package.json`
pins publication to `https://registry.npmjs.org/` so a local mirror does not
receive the package.
