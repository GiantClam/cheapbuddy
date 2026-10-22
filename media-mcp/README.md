# `@cheapbuddy/media-mcp`

CheapBuddy Media MCP is a local, stdio-only Model Context Protocol server for
the authenticated CheapBuddy image and MiniMax-H3 video HTTP APIs. It can be
used by any MCP host that launches local stdio servers, including Claude
Desktop, Claude Code, Codex, and OpenCode.

MCP tools are host-side capabilities. Installing this npm package does not add
tools to every assistant automatically: the host must launch the process,
complete the MCP handshake, and discover `tools/list` before a model can call
anything. If a prompt says that the tools are not available, check the host's
MCP server status and logs first.

## Install

Node.js 20 or newer is required. For clients that support environment
substitution (for example Claude Code, Codex, and OpenCode), configure the MCP
client with an environment variable rather than putting a key in arguments or
a project file:

```json
{
  "mcpServers": {
    "cheapbuddy-media": {
      "command": "npx",
      "args": ["--yes", "--registry=https://registry.npmjs.org", "@cheapbuddy/media-mcp@0.1.3"],
      "env": {
        "CHEAPBUDDY_API_KEY": "${CHEAPBUDDY_API_KEY}"
      }
    }
  }
}
```

`CHEAPBUDDY_BASE_URL` is optional and is useful for a compatible self-hosted or
local Relay. The package does not implement login, key persistence, OAuth, or
CLI key arguments. Do not commit credentials. The explicit npm registry flag
avoids a stale or incomplete local mirror; remove it only when your mirror is
known to carry the package tarball.

Ready-to-adapt client snippets are in `examples/claude-desktop.mcp.json`,
`examples/claude-code.mcp.json`, `examples/codex.toml`, and
`examples/opencode.json`. Keep the environment-variable syntax appropriate to
the installed client.

Copyable host-specific setup prompts are in
[`INSTALL-PROMPTS.md`](./INSTALL-PROMPTS.md). The website configuration center
also exposes the same prompts without copying an API key to the clipboard.

### Claude Desktop

Use `examples/claude-desktop.mcp.json` in the file opened by **Settings →
Developer → Edit Config** (`%APPDATA%\Claude\claude_desktop_config.json` on
Windows). The Desktop example uses a literal placeholder so it does not depend
on shell-expansion behavior; replace `REPLACE_WITH_YOUR_CHEAPBUDDY_API_KEY`
with the key on that machine. Do not use `${CHEAPBUDDY_API_KEY}` there unless
the installed Desktop build explicitly documents expansion for it. Fully quit
and reopen Claude Desktop, then check the Developer MCP status/log for
`cheapbuddy-media`.

For a true one-click install, build the Desktop Extension bundle from the
included `manifest.json` with `npm run pack:mcpb`, then install the resulting
`.mcpb` file from **Settings → Extensions → Advanced settings → Install
Extension…**. The manifest marks the API key as sensitive so a supported Claude
Desktop build can collect it in its secure configuration UI instead of asking
the user to edit JSON. The bundle must include the server dependencies; do not
ship a bundle built from a source tree with real credentials. The website's
one-click download is `public/downloads/cheapbuddy-media.mcpb`.

### OpenCode

Merge `examples/opencode.json` into the user config at
`~/.config/opencode/opencode.json` (on Windows,
`%USERPROFILE%\.config\opencode\opencode.json`) and set
`CHEAPBUDDY_API_KEY` in the environment inherited by OpenCode. Verify the
connection with:

```powershell
$env:CHEAPBUDDY_API_KEY = "your-key"
opencode mcp list
```

The server must show `cheapbuddy-media connected` before its six tools can be
selected. If your OpenCode release uses the newer `mcp.servers` configuration
shape, add the same server with `opencode mcp add` or convert the snippet to
that schema; the executable and environment values remain the same.

### Windows and npm shims

Version 0.1.1 adds a Node shebang to the CLI. Without it, npm can
generate a Windows `.cmd` shim that tries to execute `cli.mjs` directly and
the host reports only `Connection closed`; version 0.1.0 is affected. Use
0.1.1 or later after it is published, and restart the host after upgrading.

Claude Code has two independent credential paths: the Claude model gateway
uses its own Anthropic-compatible provider credentials, while this local MCP
server uses `CHEAPBUDDY_API_KEY`. The verified local smoke path used
`tokfan/claude-opus-5-5` for Claude Code and injected the CheapBuddy key only
into the `cheapbuddy-media` MCP subprocess. A CheapBuddy key that is allowed
to call OpenAI-compatible `/v1/chat/completions` is not automatically allowed
to dispatch Anthropic `/v1/messages`; that model-gateway restriction does not
affect the MCP's own Relay calls.

## Tools

The server exposes exactly six tools:

- `cheapbuddy_list_media_models` — account-scoped image/video model discovery.
- `cheapbuddy_quote_image` and `cheapbuddy_quote_video` — optional read-only
  rate cards or non-exact estimates. They do not reserve balance.
- `cheapbuddy_generate_image` — `generate`, `edit`, and `variation`, including
  masks and model-permitted multiple images.
- `cheapbuddy_submit_video` — non-blocking MiniMax-H3 submission with text,
  first/last frames, reference images, video, and audio.
- `cheapbuddy_get_media_job` — stateless image/video task lookup.

Write tools consume CheapBuddy account balance directly. There is intentionally
no budget system, forced quote/confirmation step, batch tool, or blocking video
wait tool. This keeps repeated and automated generation possible while Relay
continues to enforce account balance, rate limits, idempotency, reservation,
settlement, and task ownership.

## Media inputs and outputs

Inputs are either an absolute regular local file path or an HTTPS URL. Symlinks,
directories, special files, HTTP URLs, local/private/metadata addresses,
embedded URL credentials, unsupported MIME types, and oversized files are
rejected. Signed HTTPS query parameters are passed through unchanged. Local
files are sent directly as multipart data; they are not first copied to the
temporary media store. When an image edit mixes local and remote references,
local bytes are represented as request-scoped data URLs so the remote URL can
remain untouched; the request remains bounded by the Relay body limit.

Image results may be returned as a provider URL or `b64_json`. Base64 images
are validated and uploaded through authenticated `/v1/media` to obtain a
short-lived Relay URL. Video results are returned as Relay/provider artifact
URLs and never as base64. Use `expires_at` when present and download temporary
artifacts promptly.

Image generation may poll a processing task for up to 300 seconds, then returns
an `img_task_...` ID and `poll_after_ms`. Video submission always returns
immediately with a `vid_task_...` ID (or an explicit accepted-unknown result);
call `cheapbuddy_get_media_job` to query it. Completed video jobs now include a
short-lived Relay capability URL that can be downloaded without copying the
CheapBuddy API key into a browser or media client request. Older Relays fall
back to the authenticated `/v1/videos/{id}/content` URL. IDs encode only the
underlying Relay task ID and remain valid after this process restarts; no local
task database is used.

## Architecture and security boundary

The package calls existing Relay routes (`/v1/models`, `/v1/pricing`, image
routes, `/v1/videos`, task routes, and `/v1/media`) using the CheapBuddy Bearer
key. It does **not** require or add a NewAPI MCP Server, `/mcp` route, generic
Relay MCP forwarding, direct provider access, provider credentials, billing
formulas, or H3 polling logic. NewAPI remains responsible for provider
adaptation, task persistence, artifacts, and upstream credentials; Relay
remains responsible for public authentication and billing.

## Development

```powershell
npm install
npm test
npm run test:coverage
npm run lint
npm run check:secrets
npm run check:licenses
npm run audit
npm run pack:check
```

To publish after the release gates pass, authenticate against the official
registry and publish the pinned public package:

```powershell
npm login --registry=https://registry.npmjs.org
npm publish --access public
```

Before publishing, run MCP Inspector and the Relay mock contract suite, then
perform explicit Claude Code, Codex, and OpenCode smoke tests. Real image and
H3 billing/artifact reconciliation are release gates and are not performed by
the automated unit test suite.
