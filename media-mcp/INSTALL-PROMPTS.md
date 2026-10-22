# Media MCP 一键配置提示词

这些提示词的目标是让目标 Agent 直接完成本机配置，而不是只返回说明。提示词不包含真实 API Key；先在目标客户端的用户环境中准备 `CHEAPBUDDY_API_KEY`。

## OpenCode

```text
请在当前机器安装 CheapBuddy Media MCP，并直接执行文件操作：先备份用户级 ~/.config/opencode/opencode.json（Windows 为 %USERPROFILE%\\.config\\opencode\\opencode.json），再合并一个名为 cheapbuddy-media 的本地 MCP Server，保留其他配置。使用 npx --yes --registry=https://registry.npmjs.org @cheapbuddy/media-mcp@0.1.3，环境变量使用 {env:CHEAPBUDDY_API_KEY}，不要把 API Key 写入文件。如果当前 OpenCode 版本使用 mcp.servers 结构，使用同一条 server 配置转换到该结构。设置 CHEAPBUDDY_API_KEY 后完全重启 OpenCode，运行 opencode mcp list，确认 cheapbuddy-media connected，再检查 tools/list 返回 6 个 CheapBuddy 媒体工具。
```

## Claude Code

```text
请为 Claude Code 配置 CheapBuddy Media MCP，并直接修改用户级配置（不要只解释）：先备份 ~/.claude.json（Windows 为 %USERPROFILE%\\.claude.json），保留其他 mcpServers，将 cheapbuddy-media 合并为 stdio Server，command 为 npx，args 为 ["--yes", "--registry=https://registry.npmjs.org", "@cheapbuddy/media-mcp@0.1.3"]，env 为 {"CHEAPBUDDY_API_KEY":"${CHEAPBUDDY_API_KEY}"}。不要把真实 Key 写入文件；如果环境变量不存在，先要求用户设置。保存后完全重启 Claude Code，运行 claude mcp list，确认连接成功，再发送 tools/list 并确认 6 个媒体工具。
```

## Codex

```text
请为 Codex 配置 CheapBuddy Media MCP，并直接修改用户级 ~/.codex/config.toml（Windows 为 %USERPROFILE%\\.codex\\config.toml）：先备份文件，保留无关设置，合并 [mcp_servers.cheapbuddy_media]，command = "npx"，args = ["--yes", "--registry=https://registry.npmjs.org", "@cheapbuddy/media-mcp@0.1.3"]，并在 [mcp_servers.cheapbuddy_media.env] 中设置 CHEAPBUDDY_API_KEY = "${CHEAPBUDDY_API_KEY}"。不要写入真实 Key。保存后完全重启 Codex，运行 codex mcp list，确认 connected，再用 tools/list 验证 6 个工具。
```

## Claude Desktop

Claude Desktop 的普通 JSON 配置通常不会展开 `${CHEAPBUDDY_API_KEY}`。使用设置中的 **Developer → Edit Config** 打开 `%APPDATA%\\Claude\\claude_desktop_config.json`（macOS 为 `~/Library/Application Support/Claude/claude_desktop_config.json`），先备份，再合并 `examples/claude-desktop.mcp.json`。只在本机将 `REPLACE_WITH_YOUR_CHEAPBUDDY_API_KEY` 替换为真实 Key，完全退出并重新打开 Claude Desktop，然后在 Developer MCP 状态或日志中确认 `cheapbuddy-media` 和 6 个工具。

如果用户使用支持 Desktop Extensions 的新版 Claude Desktop，推荐直接下载仓库发布的 [`public/downloads/cheapbuddy-media.mcpb`](../public/downloads/cheapbuddy-media.mcpb) 并安装：仓库中的 `manifest.json` 已声明敏感的 `api_key` 配置，Claude Desktop 会在安装界面收集并安全保存它，不需要用户手动编辑 JSON。维护者在 `media-mcp` 目录执行：

```powershell
npm install
npm run pack:mcpb
```

生成的 `.mcpb` 文件可在 Claude Desktop 的 **Settings → Extensions → Advanced settings → Install Extension…** 中安装。发布前必须验证 `manifest.json`、`initialize` 和 `tools/list`；不要把含真实 Key 的配置或测试文件打进包。当前网站下载入口使用 `public/downloads/cheapbuddy-media.mcpb`，由本地 `media-mcp.mcpb` 复制生成。

## 故障检查

```powershell
npx --yes --registry=https://registry.npmjs.org @cheapbuddy/media-mcp@0.1.3 --help
npx --yes --registry=https://registry.npmjs.org @cheapbuddy/media-mcp@0.1.3 --version
```

`--help` 和 `--version` 不需要 API Key；正常启动时 stdout 只能包含 MCP JSON-RPC 帧，诊断写入 stderr。若客户端显示 `Connection closed`，先执行 `npm view @cheapbuddy/media-mcp@0.1.3 version --registry=https://registry.npmjs.org`；只有确认目标版本已发布后，才让 OpenCode、Claude Code 或 Codex 使用该 npm 版本。Claude Desktop 优先使用 `.mcpb`，绕过安装器对 npm CLI 的 `--help` 探测。
