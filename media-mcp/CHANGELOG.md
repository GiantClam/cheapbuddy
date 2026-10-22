# Changelog

## 0.1.3

- Derive the MCP `serverInfo.version` from the package metadata so protocol
  handshakes stay aligned with the published npm version.

## 0.1.1

- Add a Node shebang to the CLI so npm-generated Windows shims launch the
  stdio server with Node instead of attempting to execute the `.mjs` file
  directly.
- Document host-specific MCP setup and add a Claude Desktop configuration
  example.
- Pin example `npx` commands to the official npm registry to avoid incomplete
  mirror tarballs during first-time installation.

## 0.1.2

- Return short-lived Relay capability URLs for completed video artifacts so
  downloads do not fail when a browser or media client omits the Bearer key.
