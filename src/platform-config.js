export const platformOptions = [
  { id: 'workbuddy', name: 'WorkBuddy', mark: 'WB' },
  { id: 'claude', name: 'Claude Code', mark: 'CL' },
  { id: 'opencode', name: 'OpenCode', mark: 'OC' },
  { id: 'codex', name: 'Codex', mark: 'CX' },
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
    for (const field of ['maxInputTokens', 'maxOutputTokens']) {
      if (!Number.isSafeInteger(model[field]) || model[field] <= 0) {
        throw new Error(`${model.id} has an invalid ${field}`);
      }
    }
  });
}

function requireOptions(platformId, { apiKey, baseUrl, models } = {}) {
  if (!platformOptions.some(({ id }) => id === platformId)) {
    throw new Error(`Unsupported platform: ${platformId}`);
  }
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('Select at least one model');
  }
  if (!apiKey) throw new Error('An API key is required');
  validateModels(models);
  validateBaseUrl(baseUrl);
}

function makeWorkBuddyConfig(models, apiKey, apiBaseUrl) {
  return {
    models: models.map((model) => ({
      id: model.id,
      name: model.short,
      vendor: model.vendor,
      apiKey,
      url: `${apiBaseUrl}/chat/completions`,
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
  };
}

function makeClaudeConfig(models, apiKey, apiBaseUrl) {
  const defaultModel = models[0];
  return {
    env: {
      ANTHROPIC_BASE_URL: apiBaseUrl.replace(/\/v1$/i, ''),
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: defaultModel.id,
      ANTHROPIC_CUSTOM_MODEL_OPTION: defaultModel.id,
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: defaultModel.short,
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(defaultModel.maxInputTokens),
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(defaultModel.maxOutputTokens),
    },
  };
}

function makeOpenCodeConfig(models, apiKey, apiBaseUrl) {
  const providerModels = Object.fromEntries(models.map((model) => [
    model.id,
    {
      name: model.short,
      limit: {
        context: model.maxInputTokens,
        output: model.maxOutputTokens,
      },
    },
  ]));

  return {
    $schema: 'https://opencode.ai/config.json',
    model: `cheapbuddy/${models[0].id}`,
    provider: {
      cheapbuddy: {
        npm: '@ai-sdk/openai-compatible',
        name: 'CheapBuddy',
        options: {
          baseURL: apiBaseUrl,
          apiKey,
        },
        models: providerModels,
      },
    },
  };
}

function quoteToml(value) {
  return JSON.stringify(String(value));
}

function makeCodexConfig(models, apiBaseUrl) {
  const defaultModel = models[0];
  return [
    `model = ${quoteToml(defaultModel.id)}`,
    'model_provider = "cheapbuddy"',
    `model_context_window = ${Number(defaultModel.maxInputTokens)}`,
    '',
    '[model_providers.cheapbuddy]',
    'name = "CheapBuddy"',
    `base_url = ${quoteToml(apiBaseUrl)}`,
    'env_key = "CHEAPBUDDY_API_KEY"',
    'env_key_instructions = "Set CHEAPBUDDY_API_KEY in your environment before launching Codex"',
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

export function createPlatformArtifact(platformId, options) {
  requireOptions(platformId, options);
  const apiBaseUrl = normalizeBaseUrl(options.baseUrl);
  const { apiKey, models } = options;
  let content;

  if (platformId === 'workbuddy') {
    content = JSON.stringify(makeWorkBuddyConfig(models, apiKey, apiBaseUrl), null, 2);
  } else if (platformId === 'claude') {
    content = JSON.stringify(makeClaudeConfig(models, apiKey, apiBaseUrl), null, 2);
  } else if (platformId === 'opencode') {
    content = JSON.stringify(makeOpenCodeConfig(models, apiKey, apiBaseUrl), null, 2);
  } else {
    content = makeCodexConfig(models, apiBaseUrl);
  }

  return {
    platformId,
    defaultModelId: models[0].id,
    apiKey,
    credentialEnvKey: platformId === 'codex' ? 'CHEAPBUDDY_API_KEY' : null,
    content,
    ...artifactMetadata[platformId],
  };
}

export function buildInstallPrompt(artifact, language = 'zh') {
  const platform = platformOptions.find(({ id }) => id === artifact.platformId)?.name || artifact.platformId;
  const credentialStep = artifact.credentialEnvKey
    ? `\n4. Set ${artifact.credentialEnvKey} to this API key in your user environment before launching ${platform}: ${artifact.apiKey}\n5. Save the file, keep the API key private, and report the final path.\n6. Fully restart ${platform}.`
    : `\n4. Save the file, keep the API key private, and report the final path.\n5. Fully restart ${platform}.`;
  if (language === 'en') {
    return `Configure ${platform} to use CheapBuddy. Perform the file operation instead of only explaining it.\n\n1. Open ${artifact.configPath} (Windows: ${artifact.windowsPath}) and create the parent directory if needed.\n2. Back up the existing file if present.\n3. Merge the configuration below into the existing file, preserving unrelated settings. The generated values win on conflicts.${credentialStep}\n\nGenerated ${artifact.filename}:\n${artifact.content}`;
  }
  const chineseCredentialStep = artifact.credentialEnvKey
    ? `\n4. 在启动 ${platform} 前，将用户环境变量 ${artifact.credentialEnvKey} 设置为此 API Key：${artifact.apiKey}\n5. 保存文件、保护好 API Key，并告知最终路径。\n6. 完全退出并重新启动 ${platform}。`
    : `\n4. 保存文件、保护好 API Key，并告知最终路径。\n5. 完全退出并重新启动 ${platform}。`;
  return `请将 ${platform} 配置为使用 CheapBuddy，并直接执行文件操作，不要只解释步骤。\n\n1. 打开 ${artifact.configPath}（Windows：${artifact.windowsPath}），目录不存在时先创建。\n2. 如果已有配置文件，先创建备份。\n3. 将下面的配置合并到现有文件中，保留无关设置；字段冲突时以新配置为准。${chineseCredentialStep}\n\n生成的 ${artifact.filename}：\n${artifact.content}`;
}
