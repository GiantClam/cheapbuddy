import mediaMcpPackage from '@cheapbuddy/media-mcp/package.json' with { type: 'json' };

export const platformOptions = [
  { id: 'workbuddy', name: 'WorkBuddy', mark: 'WB', modelMode: 'all', maxModels: null },
  { id: 'claude', name: 'Claude Code', mark: 'CL', modelMode: 'claude', maxModels: null },
  { id: 'opencode', name: 'OpenCode', mark: 'OC', modelMode: 'all', maxModels: null },
  { id: 'codex', name: 'Codex', mark: 'CX', modelMode: 'all', maxModels: null },
];

const MEDIA_MCP_PACKAGE = `@cheapbuddy/media-mcp@${mediaMcpPackage.version}`;
const MEDIA_MCP_REGISTRY = 'https://registry.npmjs.org';
const MEDIA_MCP_SERVER = 'cheapbuddy-media';
export const MEDIA_MCPB_DOWNLOAD_PATH = '/downloads/cheapbuddy-media.mcpb';

// These are MCP host configuration targets, rather than model gateway targets.
// Keep the paths and schema names in sync with the examples shipped by
// media-mcp so the generated setup prompt can be pasted into an existing file.
export const mediaMcpPlatformOptions = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    mark: 'CD',
    configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
    windowsPath: '%APPDATA%\\Claude\\claude_desktop_config.json',
    format: 'json',
    schema: 'mcpServers',
  },
  {
    id: 'claude',
    aliases: ['claude-code'],
    name: 'Claude Code',
    mark: 'CL',
    configPath: '~/.claude.json',
    windowsPath: '%USERPROFILE%\\.claude.json',
    format: 'json',
    schema: 'mcpServers',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    mark: 'OC',
    configPath: '~/.config/opencode/opencode.json',
    windowsPath: '%USERPROFILE%\\.config\\opencode\\opencode.json',
    format: 'json',
    schema: 'mcp',
  },
  {
    id: 'codex',
    name: 'Codex',
    mark: 'CX',
    configPath: '~/.codex/config.toml',
    windowsPath: '%USERPROFILE%\\.codex\\config.toml',
    format: 'toml',
    schema: 'mcp_servers',
  },
];

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function validateBaseUrl(value) {
  const normalized = normalizeBaseUrl(value);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('A valid base URL is required');
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost)) {
    throw new Error('Base URL must use HTTPS');
  }
  return normalized;
}

function validateModels(models) {
  const ids = new Set();
  models.forEach((model, index) => {
    if (!model || typeof model.id !== 'string' || !model.id.trim()) {
      throw new Error(`Model ${index + 1} needs a non-empty id`);
    }
    if (ids.has(model.id)) throw new Error(`Duplicate model id: ${model.id}`);
    ids.add(model.id);
    if (model.endpointPath !== undefined && (typeof model.endpointPath !== 'string' || !model.endpointPath.startsWith('/'))) {
      throw new Error(`${model.id} has an invalid endpointPath`);
    }
    for (const field of ['maxInputTokens', 'maxOutputTokens']) {
      if (!Number.isSafeInteger(model[field]) || model[field] <= 0) {
        throw new Error(`${model.id} has an invalid ${field}`);
      }
    }
  });
}

function modelEndpointPath(model) {
  return typeof model.endpointPath === 'string' && model.endpointPath.startsWith('/')
    ? model.endpointPath
    : '/chat/completions';
}

function isTextModel(model) {
  return !model.modality || model.modality === 'text';
}

function isClaudeModel(model) {
  return model.id.startsWith('claude-');
}

function supportsAnthropicMessages(model) {
  return Array.isArray(model.protocols) && model.protocols.includes('anthropic');
}

export function getModelsForPlatform(platformId, models) {
  if (!platformOptions.some(({ id }) => id === platformId)) throw new Error('Unsupported platform');
  if (!Array.isArray(models)) return [];
  const supported = models.filter((model) => !Array.isArray(model.supportedPlatforms) || model.supportedPlatforms.includes(platformId));
  return platformId === 'claude' ? supported.filter(supportsAnthropicMessages) : supported;
}

// Generated client configs use the public catalog ID. Provider-specific model
// translation belongs at the Relay/account boundary so every client sees the
// same identifier.
function modelWireId(model) {
  return model.id;
}

function accessProtocol(platformId, protocol) {
  const defaultProtocol = platformId === 'claude' ? 'anthropic' : 'openai-compatible';
  const selected = protocol || defaultProtocol;
  if (!['anthropic', 'openai-compatible'].includes(selected) ||
      (platformId !== 'opencode' && selected !== defaultProtocol)) throw new Error('Unsupported access protocol for this client');
  return selected;
}

function modelInputCapabilities(model) {
  if (model.modality === 'video') return ['text', 'image', 'video'];
  return model.supportsImages ? ['text', 'image'] : ['text'];
}

function modelOutputCapabilities(model) {
  if (model.modality === 'image') return ['image'];
  if (model.modality === 'video') return ['video'];
  return ['text'];
}

function requireOptions(platformId, { apiKey, baseUrl, models } = {}) {
  const platform = platformOptions.find(({ id }) => id === platformId);
  if (!platform) {
    throw new Error(`Unsupported platform: ${platformId}`);
  }
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('Select at least one model');
  }
  if (!apiKey) throw new Error('An API key is required');
  if (platform.maxModels && models.length > platform.maxModels) {
    throw new Error(`${platform.name} supports at most ${platform.maxModels} selected model${platform.maxModels === 1 ? '' : 's'}`);
  }
  validateModels(models);
  if (platformId === 'claude' && models.some((model) => !supportsAnthropicMessages(model))) {
    throw new Error('Claude Code requires Claude models for the Anthropic Messages protocol');
  }
  validateBaseUrl(baseUrl);
}

function workBuddyVendor(model) {
  if (typeof model.vendor === 'string') return model.vendor;
  if (model.vendor && typeof model.vendor === 'object') {
    return String(model.vendor.zh || model.vendor.en || 'CheapBuddy');
  }
  return 'CheapBuddy';
}

function makeWorkBuddyConfig(models, apiKey, apiBaseUrl) {
  const textModels = models.filter(isTextModel);
  if (textModels.length === 0) throw new Error('WorkBuddy requires at least one text model');
  return {
    models: textModels.map((model) => ({
      id: modelWireId(model),
      name: 'CheapBuddy',
      // WorkBuddy 5.5.x validates vendor as a plain string, not a localized object.
      vendor: workBuddyVendor(model),
      apiKey,
      url: `${apiBaseUrl}${isClaudeModel(model) ? '/chat/completions' : modelEndpointPath(model)}`,
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
      temperature: model.temperature,
      supportsToolCall: model.supportsToolCall,
      supportsImages: model.supportsImages,
      supportsReasoning: model.supportsReasoning,
      onlyReasoning: model.onlyReasoning,
      reasoning: model.reasoning,
      useCustomProtocol: false,
    })),
    // Keep the generated models visible in WorkBuddy's model selector.
    availableModels: textModels.map(modelWireId),
  };
}

function makeClaudeConfig(models, apiKey, apiBaseUrl) {
  const defaultModel = models[0];
  const familyRoles = Object.fromEntries(['fable', 'opus', 'sonnet'].flatMap((family) => {
    const selected = models.find(({ id }) => id.startsWith(`claude-${family}-`));
    return selected ? [[`ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`, modelWireId(selected)]] : [];
  }));
  return {
    availableModels: models.map(modelWireId),
    env: {
      ANTHROPIC_BASE_URL: apiBaseUrl,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: modelWireId(defaultModel),
      ANTHROPIC_CUSTOM_MODEL_OPTION: modelWireId(defaultModel),
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: defaultModel.short,
      ...familyRoles,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(defaultModel.maxInputTokens),
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(defaultModel.maxOutputTokens),
    },
  };
}

function makeOpenCodeProvider(models, apiKey, apiBaseUrl, native) {
  return {
    name: 'CheapBuddy',
    npm: native ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible',
    options: { baseURL: apiBaseUrl, apiKey },
    models: Object.fromEntries(models.map((model) => [model.id, {
      name: model.short,
      id: modelWireId(model),
      tool_call: model.supportsToolCall,
      reasoning: model.supportsReasoning,
      modalities: { input: modelInputCapabilities(model), output: modelOutputCapabilities(model) },
      ...(model.supportsReasoning && !isClaudeModel(model) ? { interleaved: { field: 'reasoning_content' } } : {}),
      limit: { context: model.maxInputTokens, output: model.maxOutputTokens },
    }])),
  };
}

function makeOpenCodeConfig(models, apiKey, apiBaseUrl, protocol) {
  const nativeModels = protocol === 'anthropic' ? models.filter(isClaudeModel) : [];
  const compatibleModels = protocol === 'anthropic' ? models.filter((model) => !isClaudeModel(model)) : models;
  const mixed = nativeModels.length > 0 && compatibleModels.length > 0;
  const nativeProviderId = mixed ? 'cheapbuddy-anthropic' : 'cheapbuddy';
  const provider = {
    ...(compatibleModels.length ? { cheapbuddy: makeOpenCodeProvider(compatibleModels, apiKey, apiBaseUrl, false) } : {}),
    ...(nativeModels.length ? { [nativeProviderId]: makeOpenCodeProvider(nativeModels, apiKey, apiBaseUrl, true) } : {}),
  };
  const defaultProvider = protocol === 'anthropic' && isClaudeModel(models[0]) ? nativeProviderId : 'cheapbuddy';
  return { $schema: 'https://opencode.ai/config.json', model: `${defaultProvider}/${models[0].id}`, provider };
}

function quoteToml(value) {
  return JSON.stringify(String(value));
}

function makeCodexConfig(models, apiKey, apiBaseUrl) {
  const defaultModel = models[0];
  return [
    `# Selected CheapBuddy models (switch with --model): ${models.map(({ id }) => quoteToml(id)).join(', ')}`,
    `model = ${quoteToml(modelWireId(defaultModel))}`,
    'model_provider = "cheapbuddy"',
    `model_context_window = ${Number(defaultModel.maxInputTokens)}`,
    '',
    '[model_providers.cheapbuddy]',
    'name = "CheapBuddy"',
    `base_url = ${quoteToml(apiBaseUrl)}`,
    `http_headers = { Authorization = ${quoteToml(`Bearer ${apiKey}`)} }`,
    'wire_api = "responses"',
    '',
  ].join('\n');
}

const artifactMetadata = {
  workbuddy: {
    filename: 'models.json',
    configPath: '~/.workbuddy/models.json',
    windowsPath: '%USERPROFILE%\\.workbuddy\\models.json',
    mimeType: 'application/json;charset=utf-8',
  },
  claude: {
    filename: 'settings.json',
    configPath: '~/.claude/settings.json',
    windowsPath: '%USERPROFILE%\\.claude\\settings.json',
    mimeType: 'application/json;charset=utf-8',
  },
  opencode: {
    filename: 'opencode.json',
    configPath: '~/.config/opencode/opencode.json',
    windowsPath: '%USERPROFILE%\\.config\\opencode\\opencode.json',
    mimeType: 'application/json;charset=utf-8',
  },
  codex: {
    filename: 'config.toml',
    configPath: '~/.codex/config.toml',
    windowsPath: '%USERPROFILE%\\.codex\\config.toml',
    mimeType: 'application/toml;charset=utf-8',
  },
};

function platformCompatibilityNote(platformId, language) {
  if (language === 'en') {
    if (platformId === 'opencode') {
      return ' Keep the current OpenCode `provider`, `npm`, and `options` schema; replace the CheapBuddy provider block and remove the obsolete `providers`/`package`/`settings` form. OpenAI and Anthropic providers in one generated file reuse the same verified CheapBuddy API key and base URL. Store this file at the user-level OpenCode path so it is loaded globally.';
    }
    if (platformId === 'codex') {
      return ' Codex provider settings must be written to the user-level `~/.codex/config.toml` (Windows: `%USERPROFILE%\\.codex\\config.toml`); project-local config may not override provider settings.';
    }
    if (platformId === 'claude') {
      return ' Claude Code gateway settings belong in `~/.claude/settings.json`; preserve the existing `ANTHROPIC_BASE_URL`, whether it is the root URL or ends in `/v1`. Relay normalizes SDK path aliases. Do not append `/chat/completions`.';
    }
    return '';
  }
  if (platformId === 'opencode') {
    return '当前 OpenCode 使用 `provider`、`npm` 和 `options` 字段；请替换已有 CheapBuddy provider 配置并删除旧版 `providers`/`package`/`settings` 结构。一个生成文件中的 OpenAI 与 Anthropic Provider 共用同一把已验证的 CheapBuddy API Key 和 Base URL，保存到用户级配置路径以便全局加载。';
  }
  if (platformId === 'codex') {
    return 'Codex 的 provider 配置必须写入用户级 `~/.codex/config.toml`（Windows：`%USERPROFILE%\\.codex\\config.toml`）；项目目录下的配置可能不会覆盖 provider 设置。';
  }
  if (platformId === 'claude') {
    return 'Claude Code 网关配置写入 `~/.claude/settings.json`；`ANTHROPIC_BASE_URL` 保持原有地址，无论是根地址还是以 `/v1` 结尾，SDK 拼接的路径别名由 Relay 归一化。不要再拼接 `/chat/completions`。';
  }
  return '';
}

function mediaModelNote(mediaModels, language, platformId) {
  if (!Array.isArray(mediaModels) || mediaModels.length === 0) return '';
  const models = mediaModels.map((model) => `${model.id} → ${model.endpointPath}`).join(language === 'en' ? ', ' : '、');
  if (platformId === 'workbuddy') {
    return language === 'en'
      ? ` Media models are not written into WorkBuddy's text-model configuration (${models}). Use the documented native media endpoints directly.`
      : `媒体模型不会写入 WorkBuddy 的文本模型配置（${models}）；请按官网接入文档直接调用对应的媒体接口。`;
  }
  return language === 'en'
    ? ` Media models are included with their native endpoints (${models}). Text-agent clients may not expose image/video generation UI; use the documented OpenAI-compatible media requests for those models.`
    : `已包含媒体模型及其原生接口（${models}）。文本 Agent 客户端不一定提供图片/视频生成界面；请按官网接入文档直接调用对应的 OpenAI 兼容媒体接口。`;
}

export function createPlatformArtifact(platformId, options) {
  requireOptions(platformId, options);
  const apiBaseUrl = normalizeBaseUrl(options.baseUrl);
  const { apiKey, models } = options;
  const requestedProtocol = accessProtocol(platformId, options.protocol);
  const protocol = platformId === 'opencode' && !models.some(isClaudeModel) ? 'openai-compatible' : requestedProtocol;
  const platformModels = platformId === 'workbuddy' ? models.filter(isTextModel) : models;
  if (platformModels.length === 0) throw new Error('WorkBuddy requires at least one text model');
  let content;

  if (platformId === 'workbuddy') {
    content = JSON.stringify(makeWorkBuddyConfig(platformModels, apiKey, apiBaseUrl), null, 2);
  } else if (platformId === 'claude') {
    content = JSON.stringify(makeClaudeConfig(models, apiKey, apiBaseUrl), null, 2);
  } else if (platformId === 'opencode') {
    content = JSON.stringify(makeOpenCodeConfig(models, apiKey, apiBaseUrl, protocol), null, 2);
  } else {
    content = makeCodexConfig(models, apiKey, apiBaseUrl);
  }

  return {
    platformId,
    protocol,
    apiKeyGroupId: options.apiKeyGroupId ?? null,
    defaultModelId: platformModels[0].id,
    apiKey,
    credentialEnvKey: null,
    content,
    mediaModels: models.filter((model) => model.modality && model.modality !== 'text').map((model) => ({ id: model.id, modality: model.modality, endpointPath: modelEndpointPath(model) })),
    ...artifactMetadata[platformId],
  };
}

export function buildConnectionTestRequest(platformId, { baseUrl, model, protocol } = {}) {
  if (!platformOptions.some(({ id }) => id === platformId)) throw new Error('Unsupported platform');
  if (!model?.id) throw new Error('Select a model');
  if (platformId === 'claude' && !supportsAnthropicMessages(model)) {
    throw new Error('Claude Code requires Claude models for the Anthropic Messages protocol');
  }
  const apiBaseUrl = validateBaseUrl(baseUrl);
  const selectedProtocol = accessProtocol(platformId, protocol);
  if (!isTextModel(model)) {
    return { method: 'GET', url: `${apiBaseUrl}/models`, isValid: (body) => Array.isArray(body.data) && body.data.some(({ id }) => id === model.id) };
  }
  const common = { model: modelWireId(model), stream: false };
  if (platformId === 'claude' || (platformId === 'opencode' && selectedProtocol === 'anthropic' && isClaudeModel(model))) {
    return {
      url: `${apiBaseUrl}/messages`, headers: { 'anthropic-version': '2023-06-01' },
      body: { ...common, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with OK only.' }] },
      isValid: (body) => Array.isArray(body.content) && body.content.length > 0,
    };
  }
  if (platformId === 'codex') {
    return { url: `${apiBaseUrl}/responses`, body: { ...common, input: 'Reply with OK only.', max_output_tokens: 8 }, isValid: (body) => Boolean(body.id) || (Array.isArray(body.output) && body.output.length > 0) };
  }
  return {
    url: `${apiBaseUrl}/chat/completions`,
    body: {
      ...common,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_tokens: 8,
      ...(!isClaudeModel(model) && Number.isFinite(model.temperature) ? { temperature: model.temperature } : {}),
    },
    isValid: (body) => Array.isArray(body.choices) && body.choices.length > 0,
  };
}

export function buildInstallPrompt(artifact, language = 'zh') {
  const platform = platformOptions.find(({ id }) => id === artifact.platformId)?.name || artifact.platformId;
  const workBuddyNote = artifact.platformId === 'workbuddy'
    ? language === 'en'
      ? ' For WorkBuddy 5.5.x, keep each vendor value as a plain string and replace the selected model entry instead of nesting localized vendor objects.'
      : 'WorkBuddy 5.5.x 要求每个模型的 vendor 是普通字符串；请替换对应模型条目，不要把 vendor 嵌套成中英文对象。'
    : '';
  const credentialStep = artifact.credentialEnvKey
    ? `\n4. Set ${artifact.credentialEnvKey} to this API key in your user environment before launching ${platform}: ${artifact.apiKey}\n5. Save the file, keep the API key private, and report the final path.\n6. Fully restart ${platform}.`
    : `\n4. Save the file, keep the API key private, and report the final path.\n5. Fully restart ${platform}.`;
  if (language === 'en') {
    return `Configure ${platform} to use CheapBuddy. Perform the file operation instead of only explaining it.\n\n1. Open ${artifact.configPath} (Windows: ${artifact.windowsPath}) and create the parent directory if needed.\n2. Back up the existing file if present.\n3. Merge the configuration below into the existing file, preserving unrelated settings. The generated values win on conflicts.${workBuddyNote}${platformCompatibilityNote(artifact.platformId, language)}${mediaModelNote(artifact.mediaModels, language, artifact.platformId)}${credentialStep}\n\nGenerated ${artifact.filename}:\n${artifact.content}`;
  }
  const chineseCredentialStep = artifact.credentialEnvKey
    ? `\n4. 在启动 ${platform} 前，将用户环境变量 ${artifact.credentialEnvKey} 设置为此 API Key：${artifact.apiKey}\n5. 保存文件、保护好 API Key，并告知最终路径。\n6. 完全退出并重新启动 ${platform}。`
    : `\n4. 保存文件、保护好 API Key，并告知最终路径。\n5. 完全退出并重新启动 ${platform}。`;
  return `请将 ${platform} 配置为使用 CheapBuddy，并直接执行文件操作，不要只解释步骤。\n\n1. 打开 ${artifact.configPath}（Windows：${artifact.windowsPath}），目录不存在时先创建。\n2. 如果已有配置文件，先创建备份。\n3. 将下面的配置合并到现有文件中，保留无关设置；字段冲突时以新配置为准。${workBuddyNote}${platformCompatibilityNote(artifact.platformId, language)}${mediaModelNote(artifact.mediaModels, language, artifact.platformId)}${chineseCredentialStep}\n\n生成的 ${artifact.filename}：\n${artifact.content}`;
}

function mediaMcpNpxArgs() {
  return ['--yes', `--registry=${MEDIA_MCP_REGISTRY}`, MEDIA_MCP_PACKAGE];
}

function mediaMcpJsonServer(apiKeyValue) {
  return {
    command: 'npx',
    args: mediaMcpNpxArgs(),
    env: { CHEAPBUDDY_API_KEY: apiKeyValue },
  };
}

function mediaMcpConfigSnippet(targetId) {
  if (targetId === 'claude-desktop') {
    return JSON.stringify({ mcpServers: { [MEDIA_MCP_SERVER]: mediaMcpJsonServer('REPLACE_WITH_YOUR_CHEAPBUDDY_API_KEY') } }, null, 2);
  }
  if (targetId === 'claude') {
    return JSON.stringify({ mcpServers: { [MEDIA_MCP_SERVER]: mediaMcpJsonServer('${CHEAPBUDDY_API_KEY}') } }, null, 2);
  }
  if (targetId === 'opencode') {
    return JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        [MEDIA_MCP_SERVER]: {
          type: 'local',
          command: mediaMcpNpxArgs(),
          enabled: true,
          environment: { CHEAPBUDDY_API_KEY: '{env:CHEAPBUDDY_API_KEY}' },
        },
      },
    }, null, 2);
  }
  return [
    `[mcp_servers.${MEDIA_MCP_SERVER.replace('-', '_')}]`,
    'command = "npx"',
    `args = [${mediaMcpNpxArgs().map(quoteToml).join(', ')}]`,
    '',
    `[mcp_servers.${MEDIA_MCP_SERVER.replace('-', '_')}.env]`,
    'CHEAPBUDDY_API_KEY = "${CHEAPBUDDY_API_KEY}"',
    '',
  ].join('\n');
}

function resolveMediaMcpTarget(target) {
  const targetId = typeof target === 'string' ? target : target?.id;
  return mediaMcpPlatformOptions.find(({ id, aliases = [] }) => id === targetId || aliases.includes(targetId));
}

export function buildMediaMcpInstallPrompt(target, language = 'zh') {
  const option = resolveMediaMcpTarget(target);
  if (!option) throw new Error(`Unsupported media MCP platform: ${typeof target === 'string' ? target : target?.id}`);

  const english = language === 'en';
  const path = english
    ? `${option.configPath} (Windows: ${option.windowsPath})`
    : `${option.configPath}（Windows：${option.windowsPath}）`;
  const config = mediaMcpConfigSnippet(option.id);
  const verificationCommand = option.id === 'claude-desktop'
    ? 'Open Settings → Developer → MCP status/logs'
    : option.id === 'claude'
      ? '`claude mcp list`'
      : option.id === 'opencode'
        ? '`opencode mcp list`'
        : '`codex mcp list`';

  if (english) {
    const desktopWarning = option.id === 'claude-desktop'
      ? ` Claude Desktop's most reliable path is the packaged extension: download ${MEDIA_MCPB_DOWNLOAD_PATH}, open Settings → Extensions → Advanced settings → Install Extension…, and enter the API key in the sensitive extension settings. Use the JSON below only when Desktop Extensions are unavailable; it does not reliably expand shell environment syntax, so replace the literal \`REPLACE_WITH_YOUR_CHEAPBUDDY_API_KEY\` placeholder locally. Do not make the installer probe an unpublished npm version with \`--help\`.`
      : '';
    const packageCheck = option.id === 'claude-desktop'
      ? ''
      : ` Before editing the file, verify that ${MEDIA_MCP_PACKAGE} is published with \`npm view ${MEDIA_MCP_PACKAGE} version --registry=${MEDIA_MCP_REGISTRY}\`; if the registry returns 404, stop and report that the package release is missing instead of launching an empty MCP process.`;
    const credentialStep = option.id === 'claude-desktop'
      ? 'Replace the literal API-key placeholder only on the local machine; do not put the key in the copied prompt or source repository.'
      : 'Keep the API key out of the file and inject it through the user environment variable CHEAPBUDDY_API_KEY before launching the client. The generated config intentionally contains only an environment reference.';
    const targetCommand = option.id === 'opencode'
      ? 'OpenCode uses the `mcp` object with a local `command` array and `environment` map; if this build expects `mcp.servers`, use the same server block there or run `opencode mcp add`.'
      : option.id === 'codex'
        ? 'Codex uses the `[mcp_servers.cheapbuddy_media]` TOML table and its nested `env` table.'
        : 'Use the user-level `mcpServers` object and preserve other servers.';
    return `Install the CheapBuddy Media MCP for ${option.name} by performing the file operation, not only explaining it.\n\n1. Open ${path}; create the parent directory when needed.\n2. Create a backup of the existing file before editing it.\n3. Merge the generated ${option.format.toUpperCase()} below into the existing configuration, preserving unrelated settings and existing MCP servers; the CheapBuddy server block wins only for the ${MEDIA_MCP_SERVER} key. ${targetCommand}${desktopWarning}${packageCheck}\n4. ${credentialStep}\n5. Save the file, fully quit and restart ${option.name}.\n6. Verify ${verificationCommand} shows ${MEDIA_MCP_SERVER} connected, then issue an MCP tools/list request and confirm exactly these six tools are discoverable: cheapbuddy_list_media_models, cheapbuddy_quote_image, cheapbuddy_generate_image, cheapbuddy_quote_video, cheapbuddy_submit_video, and cheapbuddy_get_media_job.\n\nGenerated configuration:\n${config}`;
  }

  const desktopWarning = option.id === 'claude-desktop'
    ? ` Claude Desktop 优先使用打包扩展：下载 ${MEDIA_MCPB_DOWNLOAD_PATH}，打开“设置 → Extensions → Advanced settings → Install Extension…”，再在扩展的敏感配置中填写 API Key。只有不支持 Desktop Extensions 时才使用下面的 JSON；它不会可靠展开 Shell 环境变量语法，请只在本机替换字面量占位符 \`REPLACE_WITH_YOUR_CHEAPBUDDY_API_KEY\`。不要让安装器通过 \`--help\` 探测尚未发布的 npm 版本。`
    : '';
  const packageCheck = option.id === 'claude-desktop'
    ? ''
    : ` 编辑文件前先执行 \`npm view ${MEDIA_MCP_PACKAGE} version --registry=${MEDIA_MCP_REGISTRY}\` 确认该版本已发布；如果返回 404，停止并报告 npm 包尚未发布，不要启动一个没有输出的 MCP 进程。`;
  const credentialStep = option.id === 'claude-desktop'
    ? '只在本机把字面量 API Key 占位符替换为真实 Key；不要把 Key 写进复制出的提示词或源码仓库。'
    : '不要把 API Key 写入文件；启动客户端前，在用户环境变量中设置 CHEAPBUDDY_API_KEY。生成配置只包含环境变量引用。';
  const targetCommand = option.id === 'opencode'
    ? 'OpenCode 使用顶层 `mcp`、`type: "local"`、数组形式的 `command` 和 `environment` 字段；如果当前版本要求 `mcp.servers`，将同一 Server 条目放到该节点，或执行 `opencode mcp add`。'
    : option.id === 'codex'
      ? 'Codex 使用 `[mcp_servers.cheapbuddy_media]` TOML 表及其嵌套的 `env` 表。'
      : '使用用户级 `mcpServers` 对象，并保留其他 MCP Server。';
  return `请为 ${option.name} 安装 CheapBuddy Media MCP，并直接执行文件操作，不要只解释步骤。\n\n1. 打开 ${path}，目录不存在时先创建。\n2. 编辑前先备份已有文件。\n3. 将下面生成的 ${option.format.toUpperCase()} 合并到现有配置，保留无关设置和其他 MCP Server；仅对 ${MEDIA_MCP_SERVER} 条目以新配置为准。${targetCommand}${desktopWarning}${packageCheck}\n4. ${credentialStep}\n5. 保存文件，完全退出并重新启动 ${option.name}。\n6. 验证 ${verificationCommand} 显示 ${MEDIA_MCP_SERVER} 已连接，然后发送 MCP tools/list 请求，确认能发现以下六个工具：cheapbuddy_list_media_models、cheapbuddy_quote_image、cheapbuddy_generate_image、cheapbuddy_quote_video、cheapbuddy_submit_video、cheapbuddy_get_media_job。\n\n生成的配置：\n${config}`;
}
