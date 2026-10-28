import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildInstallPrompt,
  buildMediaMcpInstallPrompt,
  createPlatformArtifact,
  MEDIA_MCPB_DOWNLOAD_PATH,
  mediaMcpPlatformOptions,
  platformOptions,
} from './platform-config.js';
import mediaMcpPackage from '@cheapbuddy/media-mcp/package.json' with { type: 'json' };
import { modelCatalog } from './models.js';
import * as platformHelpers from './platform-config.js';

const selectedModels = [
  {
    id: 'glm-5.2',
    short: 'GLM 5.2',
    vendor: 'Zhipu',
    maxInputTokens: 128000,
    maxOutputTokens: 8192,
    temperature: 1,
    supportsToolCall: true,
    supportsImages: false,
    supportsReasoning: true,
    onlyReasoning: false,
    reasoning: { effort: 'max' },
  },
  {
    id: 'MiniMax-M3',
    short: 'MiniMax M3',
    vendor: 'MiniMax',
    maxInputTokens: 128000,
    maxOutputTokens: 8192,
    temperature: 1,
    supportsToolCall: true,
    supportsImages: true,
    supportsReasoning: true,
    onlyReasoning: false,
    reasoning: { effort: 'medium' },
  },
];

const generatedApiKey = ['test', 'api', 'key'].join('-');

const options = {
  apiKey: generatedApiKey,
  baseUrl: 'https://api.cheapbuddy.cc/v1/',
  models: selectedModels,
};
const singleModelOptions = { ...options, models: [selectedModels[0]] };
const grokModel = {
  id: 'grok-4.7',
  short: 'Grok 4.7',
  vendor: 'xAI',
  maxInputTokens: 500000,
  maxOutputTokens: 32768,
  temperature: 1,
  supportsToolCall: true,
  supportsImages: true,
  supportsReasoning: true,
  onlyReasoning: false,
  reasoning: { effort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh'] },
};
const gpt6AstraModel = {
  id: 'gpt-6-astra',
  short: 'GPT-6 Astra',
  vendor: 'OpenAI',
  maxInputTokens: 1050000,
  maxOutputTokens: 128000,
  temperature: 1,
  supportsToolCall: true,
  supportsImages: true,
  supportsReasoning: true,
  onlyReasoning: false,
  reasoning: { effort: 'high' },
};

test('publishes every supported target platform', () => {
  assert.deepEqual(platformOptions.map(({ id }) => id), ['workbuddy', 'claude', 'opencode', 'codex']);
  assert.deepEqual(platformOptions.map(({ maxModels }) => maxModels), [null, null, null, null]);
});

test('publishes the four Media MCP host targets with their user-level config paths', () => {
  assert.deepEqual(mediaMcpPlatformOptions.map(({ id }) => id), ['claude-desktop', 'claude', 'opencode', 'codex']);
  assert.equal(mediaMcpPlatformOptions.find(({ id }) => id === 'claude-desktop').windowsPath, '%APPDATA%\\Claude\\claude_desktop_config.json');
  assert.equal(mediaMcpPlatformOptions.find(({ id }) => id === 'claude').configPath, '~/.claude.json');
  assert.equal(mediaMcpPlatformOptions.find(({ id }) => id === 'opencode').configPath, '~/.config/opencode/opencode.json');
  assert.equal(mediaMcpPlatformOptions.find(({ id }) => id === 'codex').configPath, '~/.codex/config.toml');
});

test('builds secret-free Media MCP install prompts with host-specific schemas', () => {
  const prompts = Object.fromEntries(['claude-desktop', 'claude', 'opencode', 'codex'].map((id) => [id, buildMediaMcpInstallPrompt(id, 'en')]));

  assert.match(prompts['claude-desktop'], /claude_desktop_config\.json/);
  assert.match(prompts['claude-desktop'], /mcpServers/);
  assert.match(prompts['claude-desktop'], /REPLACE_WITH_YOUR_CHEAPBUDDY_API_KEY/);
  assert.match(prompts['claude-desktop'], /does not reliably expand shell environment syntax/i);
  assert.match(prompts.claude, /\.claude\.json/);
  assert.match(prompts.claude, /CHEAPBUDDY_API_KEY.*\$\{CHEAPBUDDY_API_KEY\}/s);
  assert.match(prompts.opencode, /"mcp"/);
  assert.match(prompts.opencode, /"type": "local"/);
  assert.match(prompts.opencode, /\{env:CHEAPBUDDY_API_KEY\}/);
  assert.match(prompts.codex, /\[mcp_servers\.cheapbuddy_media\]/);
  assert.match(prompts.codex, /CHEAPBUDDY_API_KEY = "\$\{CHEAPBUDDY_API_KEY\}"/);

  for (const prompt of Object.values(prompts)) {
    assert.match(prompt, /registry=https:\/\/registry\.npmjs\.org/);
    assert.match(prompt, new RegExp(`@cheapbuddy/media-mcp@${mediaMcpPackage.version.replaceAll('.', '\\.')}`));
    assert.match(prompt, /CHEAPBUDDY_API_KEY/);
    assert.match(prompt, /backup/i);
    assert.match(prompt, /merge/i);
    assert.match(prompt, /restart/i);
    assert.match(prompt, /tools\/list/);
    assert.doesNotMatch(prompt, /sk-[A-Za-z0-9]|cb_live_[A-Za-z0-9]/);
  }

  assert.match(buildMediaMcpInstallPrompt('claude-code', 'en'), /\.claude\.json/);
  assert.match(prompts['claude-desktop'], /downloads\/cheapbuddy-media\.mcpb/);
  assert.match(prompts.claude, /npm view .*registry\.npmjs\.org/);
  assert.match(prompts.opencode, /returns 404|404/);
  assert.equal(MEDIA_MCPB_DOWNLOAD_PATH, '/downloads/cheapbuddy-media.mcpb');
  assert.throws(() => buildMediaMcpInstallPrompt('workbuddy'), /Unsupported media MCP platform/);
});

test('ships the Claude Desktop MCPB download asset', () => {
  const assetPath = path.resolve(process.cwd(), 'public', MEDIA_MCPB_DOWNLOAD_PATH.slice(1));
  assert.equal(fs.existsSync(assetPath), true);
  assert.ok(fs.statSync(assetPath).size > 100000);
});

test('builds the existing WorkBuddy models file', () => {
  const artifact = createPlatformArtifact('workbuddy', options);
  const config = JSON.parse(artifact.content);

  assert.equal(artifact.filename, 'models.json');
  assert.equal(artifact.configPath, '~/.workbuddy/models.json');
  assert.equal(config.models.length, 2);
  assert.equal(config.models[0].url, 'https://api.cheapbuddy.cc/v1/chat/completions');
  assert.equal(config.models[0].apiKey, options.apiKey);
  assert.equal(config.models[0].id, 'glm-5.2');
  assert.equal(config.models[0].name, 'CheapBuddy');
  assert.equal(config.models[0].vendor, 'Zhipu');
  assert.deepEqual(config.availableModels, ['glm-5.2', 'MiniMax-M3']);
  assert.match(buildInstallPrompt(artifact), /vendor 是普通字符串/);
});

test('normalizes localized vendor objects for WorkBuddy', () => {
  const artifact = createPlatformArtifact('workbuddy', {
    ...singleModelOptions,
    models: [{ ...selectedModels[0], vendor: { zh: '智谱', en: 'Zhipu' } }],
  });

  assert.equal(JSON.parse(artifact.content).models[0].vendor, '智谱');
});

test('builds a Claude Code user gateway config using the Messages endpoint base', () => {
  const claudeModel = modelCatalog.find(({ id }) => id === 'claude-sonnet-5-5');
  const artifact = createPlatformArtifact('claude', { ...options, models: [claudeModel] });
  const config = JSON.parse(artifact.content);

  assert.equal(artifact.filename, 'settings.json');
  assert.equal(artifact.configPath, '~/.claude/settings.json');
  assert.equal(config.env.ANTHROPIC_BASE_URL, 'https://api.cheapbuddy.cc/v1');
  assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, options.apiKey);
  assert.equal(config.env.ANTHROPIC_MODEL, claudeModel.id);
  assert.equal(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined);
  assert.equal(config.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
  assert.match(buildInstallPrompt(artifact), /ANTHROPIC_BASE_URL.*原有.*\/v1/);
});

test('builds an OpenCode provider with all selected models', () => {
  const artifact = createPlatformArtifact('opencode', options);
  const config = JSON.parse(artifact.content);
  const provider = config.provider.cheapbuddy;

  assert.equal(artifact.filename, 'opencode.json');
  assert.equal(artifact.configPath, '~/.config/opencode/opencode.json');
  assert.equal(config.model, 'cheapbuddy/glm-5.2');
  assert.equal(provider.npm, '@ai-sdk/openai-compatible');
  assert.equal(provider.options.baseURL, 'https://api.cheapbuddy.cc/v1');
  assert.equal(provider.options.apiKey, options.apiKey);
  assert.deepEqual(Object.keys(provider.models), ['glm-5.2', 'MiniMax-M3']);
  assert.equal(provider.models['glm-5.2'].id, 'glm-5.2');
  assert.equal(provider.models['glm-5.2'].tool_call, true);
  assert.deepEqual(provider.models['glm-5.2'].modalities, {
    input: ['text'],
    output: ['text'],
  });
  assert.deepEqual(provider.models['glm-5.2'].interleaved, { field: 'reasoning_content' });
  assert.deepEqual(provider.models['MiniMax-M3'].modalities.input, ['text', 'image']);
  assert.equal(config.providers, undefined);
  assert.match(buildInstallPrompt(artifact), /provider.*npm.*options/);
  assert.match(buildInstallPrompt(artifact, 'en'), /obsolete.*providers.*package.*settings/);
});

test('builds a Codex Responses API provider with the first model as default', () => {
  const artifact = createPlatformArtifact('codex', { ...options, models: [selectedModels[0]] });

  assert.equal(artifact.filename, 'config.toml');
  assert.equal(artifact.configPath, '~/.codex/config.toml');
  assert.match(artifact.content, /^model = "glm-5\.2"/m);
  assert.match(artifact.content, /^model_provider = "cheapbuddy"/m);
  assert.match(artifact.content, /^base_url = "https:\/\/api\.cheapbuddy\.cc\/v1"/m);
  assert.match(artifact.content, /^wire_api = "responses"/m);
  assert.match(artifact.content, new RegExp(`^http_headers = \\{ Authorization = "Bearer ${generatedApiKey}" \\}$`, 'm'));
  assert.doesNotMatch(artifact.content, /experimental_bearer_token/);
  assert.match(buildInstallPrompt(artifact, 'en'), new RegExp(`Authorization.*Bearer ${generatedApiKey}`, 's'));
  assert.match(buildInstallPrompt(artifact, 'en'), /user-level.*config\.toml/);
});

test('keeps Grok 4.7 in generated platform configurations', () => {
  const grokOptions = { ...options, models: [grokModel] };

  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', grokOptions).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', grokOptions).content);
  const codex = createPlatformArtifact('codex', grokOptions).content;

  assert.equal(workbuddy.models[0].id, 'grok-4.7');
  assert.equal(workbuddy.models[0].maxInputTokens, 500000);
  assert.equal(opencode.provider.cheapbuddy.models['grok-4.7'].limit.context, 500000);
  assert.throws(() => createPlatformArtifact('claude', grokOptions), /Claude Code requires Claude models/i);
  assert.match(codex, /^model = "grok-4\.7"/m);
});

test('keeps GPT-6 Astra in every generated platform configuration', () => {
  const astraOptions = { ...options, models: [gpt6AstraModel] };

  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', astraOptions).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', astraOptions).content);
  const codex = createPlatformArtifact('codex', astraOptions).content;

  assert.equal(workbuddy.models[0].id, 'gpt-6-astra');
  assert.equal(workbuddy.models[0].name, 'CheapBuddy');
  assert.equal(opencode.provider.cheapbuddy.models['gpt-6-astra'].id, 'gpt-6-astra');
  assert.equal(opencode.provider.cheapbuddy.models['gpt-6-astra'].limit.context, 1050000);
  assert.throws(() => createPlatformArtifact('claude', astraOptions), /Claude Code requires Claude models/i);
  assert.match(codex, /^model = "gpt-6-astra"/m);
});

test('keeps GPT-6.1 Sol in every generated platform configuration', () => {
  const sol61Model = modelCatalog.find(({ id }) => id === 'gpt-6.1-sol');
  const sol61Options = { ...options, models: [sol61Model] };

  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', sol61Options).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', sol61Options).content);
  const codex = createPlatformArtifact('codex', sol61Options).content;

  assert.equal(workbuddy.models[0].id, 'gpt-6.1-sol');
  assert.equal(workbuddy.models[0].maxInputTokens, 922000);
  assert.equal(opencode.provider.cheapbuddy.models['gpt-6.1-sol'].id, 'gpt-6.1-sol');
  assert.equal(opencode.provider.cheapbuddy.models['gpt-6.1-sol'].limit.context, 922000);
  assert.throws(() => createPlatformArtifact('claude', sol61Options), /Claude Code requires Claude models/i);
  assert.match(codex, /^model = "gpt-6\.1-sol"/m);
});

test('uses deepseek-flash in every generated client configuration and connection probe', () => {
  const deepseek = modelCatalog.find(({ id }) => id === 'deepseek-flash');
  assert.ok(deepseek);
  const deepseekOptions = { ...options, models: [{ ...deepseek, providerModelId: 'deepseek-v4.1-flash-1017' }] };

  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', deepseekOptions).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', deepseekOptions).content);
  const codex = createPlatformArtifact('codex', deepseekOptions).content;

  assert.equal(workbuddy.models[0].id, 'deepseek-flash');
  assert.deepEqual(workbuddy.availableModels, ['deepseek-flash']);
  assert.equal(opencode.model, 'cheapbuddy/deepseek-flash');
  assert.equal(opencode.provider.cheapbuddy.models['deepseek-flash'].id, 'deepseek-flash');
  assert.equal(opencode.provider.cheapbuddy.models['deepseek-flash'].name, 'DeepSeek Flash');
  assert.throws(() => createPlatformArtifact('claude', deepseekOptions), /Claude Code requires Claude models/i);
  assert.match(codex, /^model = "deepseek-flash"/m);
  for (const platform of ['workbuddy', 'opencode', 'codex']) {
    assert.doesNotMatch(createPlatformArtifact(platform, deepseekOptions).content, /deepseek\/deepseek-v4\.1-flash/);
  }
  assert.equal(platformHelpers.buildConnectionTestRequest('workbuddy', {
    baseUrl: options.baseUrl,
    model: deepseek,
  }).body.model, 'deepseek-flash');
});

test('publishes DeepSeek V4.1 Flash 1017 in every generated client configuration', () => {
  const deepseek1017 = modelCatalog.find(({ id }) => id === 'deepseek-v4.1-flash-1017');
  assert.ok(deepseek1017);
  const deepseekOptions = { ...options, models: [deepseek1017] };

  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', deepseekOptions).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', deepseekOptions).content);
  const codex = createPlatformArtifact('codex', deepseekOptions).content;

  assert.equal(workbuddy.models[0].id, 'deepseek-v4.1-flash-1017');
  assert.deepEqual(workbuddy.availableModels, ['deepseek-v4.1-flash-1017']);
  assert.equal(opencode.model, 'cheapbuddy/deepseek-v4.1-flash-1017');
  assert.equal(opencode.provider.cheapbuddy.models['deepseek-v4.1-flash-1017'].id, 'deepseek-v4.1-flash-1017');
  assert.throws(() => createPlatformArtifact('claude', deepseekOptions), /Claude Code requires Claude models/i);
  assert.match(codex, /^model = "deepseek-v4\.1-flash-1017"/m);
  assert.equal(platformHelpers.buildConnectionTestRequest('workbuddy', {
    baseUrl: options.baseUrl,
    model: deepseek1017,
  }).body.model, 'deepseek-v4.1-flash-1017');
});

test('copy configuration keeps public and canonical DeepSeek IDs in both languages', () => {
  for (const id of ['deepseek-v4.1-flash-1017', 'deepseek-flash']) {
    const deepseek = modelCatalog.find((model) => model.id === id);
    assert.ok(deepseek);
    for (const platformId of ['workbuddy', 'opencode', 'codex']) {
      const artifact = createPlatformArtifact(platformId, { ...options, models: [deepseek] });
      assert.equal(artifact.defaultModelId, id);
      for (const language of ['zh', 'en']) {
        const prompt = buildInstallPrompt(artifact, language);
        assert.ok(prompt.includes(id));
        assert.doesNotMatch(prompt, /deepseek-4\.1-flash-1017/);
        assert.doesNotMatch(prompt, /deepseek\/deepseek-v4\.1-flash/);
      }
      assert.equal(platformHelpers.buildConnectionTestRequest(platformId, {
        baseUrl: options.baseUrl, model: deepseek,
      }).body.model, id);
    }
  }
});

test('keeps media models selectable with their native endpoints and capabilities', () => {
  const textModel = { ...selectedModels[0] };
  const mediaModels = [
    {
      id: 'gpt-image-2.5', short: 'GPT Image 2.5', vendor: 'OpenAI', modality: 'image', endpointPath: '/images/generations',
      maxInputTokens: 128000, maxOutputTokens: 1, temperature: 1, supportsToolCall: false, supportsImages: true, supportsReasoning: false, onlyReasoning: false,
    },
    {
      id: 'MiniMax-H3', short: 'MiniMax H3', vendor: 'MiniMax', modality: 'video', endpointPath: '/videos',
      maxInputTokens: 128000, maxOutputTokens: 1, temperature: 1, supportsToolCall: false, supportsImages: true, supportsReasoning: false, onlyReasoning: false,
    },
  ];
  const optionsWithMedia = { ...options, models: [textModel, ...mediaModels] };
  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', optionsWithMedia).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', optionsWithMedia).content);
  const prompt = buildInstallPrompt(createPlatformArtifact('workbuddy', optionsWithMedia));

  assert.deepEqual(workbuddy.models.map(({ id }) => id), ['glm-5.2']);
  assert.deepEqual(workbuddy.availableModels, ['glm-5.2']);
  assert.doesNotMatch(JSON.stringify(workbuddy), /MiniMax-H3|gpt-image-2\.5/);
  assert.deepEqual(opencode.provider.cheapbuddy.models['gpt-image-2.5'].modalities.output, ['image']);
  assert.deepEqual(opencode.provider.cheapbuddy.models['MiniMax-H3'].modalities.output, ['video']);
  assert.match(prompt, /媒体模型不会写入 WorkBuddy 的文本模型配置/);
  assert.match(prompt, /gpt-image-2\.5.*\/images\/generations/);
  assert.match(prompt, /MiniMax-H3.*\/videos/);
});

test('verified model catalog entries are included in WorkBuddy text configuration by canonical ID', () => {
  const ids = ['glm-5.3-flash', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6-luna', 'qwen3.8-max'];
  const models = modelCatalog.filter(({ id }) => ids.includes(id));
  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', { ...options, models }).content);

  assert.deepEqual(workbuddy.availableModels, ids);
  assert.deepEqual(workbuddy.models.map(({ id }) => id), ids);
  assert.ok(workbuddy.models.every(({ url }) => url === 'https://api.cheapbuddy.cc/v1/chat/completions'));
});

test('rejects a WorkBuddy configuration that contains only media models', () => {
  const mediaOnly = {
    ...options,
    models: [{
      id: 'MiniMax-H3', short: 'MiniMax H3', vendor: 'MiniMax', modality: 'video', endpointPath: '/videos',
      maxInputTokens: 128000, maxOutputTokens: 1, temperature: 1, supportsToolCall: false, supportsImages: true, supportsReasoning: false, onlyReasoning: false,
    }],
  };

  assert.throws(() => createPlatformArtifact('workbuddy', mediaOnly), /at least one text model/i);
});

test('rejects invalid generator inputs', () => {
  assert.throws(() => createPlatformArtifact('codex', { ...options, models: [] }), /model/i);
  assert.throws(() => createPlatformArtifact('unknown', options), /platform/i);
  assert.throws(() => createPlatformArtifact('codex', { ...singleModelOptions, baseUrl: 'not a URL' }), /URL/i);
  assert.throws(() => createPlatformArtifact('codex', { ...singleModelOptions, baseUrl: 'http://api.cheapbuddy.cc/v1' }), /HTTPS/i);
  assert.throws(() => createPlatformArtifact('codex', { ...singleModelOptions, models: [{ ...selectedModels[0], maxInputTokens: 0 }] }), /maxInputTokens/i);
  assert.throws(() => createPlatformArtifact('workbuddy', { ...options, models: [selectedModels[0], { ...selectedModels[0] }] }), /Duplicate/i);
  assert.doesNotThrow(() => createPlatformArtifact('codex', options));
  assert.throws(() => createPlatformArtifact('claude', options), /Claude Code requires Claude models/i);
});

test('allows a local HTTP gateway during development', () => {
  const artifact = createPlatformArtifact('workbuddy', { ...options, baseUrl: 'http://127.0.0.1:8080/v1' });
  assert.match(artifact.content, /http:\/\/127\.0\.0\.1:8080\/v1\/chat\/completions/);
});

const claudeModels = [
  { ...selectedModels[0], id: 'claude-opus-5-5', short: 'Claude Opus 5.5', family: 'opus', vendor: 'Anthropic', channelId: 'claude', endpointPath: '/messages', protocols: ['anthropic', 'openai-compatible'] },
  { ...selectedModels[1], id: 'claude-sonnet-5-5', short: 'Claude Sonnet 5.5', family: 'sonnet', vendor: 'Anthropic', channelId: 'claude', endpointPath: '/messages', protocols: ['anthropic', 'openai-compatible'] },
];
const claudeOptions = { ...options, models: claudeModels, apiKeyGroupId: 3 };

test('Claude stable uses each client protocol rather than the catalog native endpoint everywhere', () => {
  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', claudeOptions).content);
  assert.ok(workbuddy.models.every(({ url }) => url === 'https://api.cheapbuddy.cc/v1/chat/completions'));
  assert.deepEqual(workbuddy.availableModels, claudeModels.map(({ id }) => id));
  const claude = JSON.parse(createPlatformArtifact('claude', claudeOptions).content);
  assert.equal(claude.env.ANTHROPIC_BASE_URL, 'https://api.cheapbuddy.cc/v1');
  assert.equal(claude.env.ANTHROPIC_AUTH_TOKEN, generatedApiKey);
  assert.equal(claude.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'claude-opus-5-5');
  assert.equal(claude.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'claude-sonnet-5-5');
  assert.equal(claude.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined);
  const opencode = JSON.parse(createPlatformArtifact('opencode', claudeOptions).content);
  assert.equal(opencode.model, 'cheapbuddy/claude-opus-5-5');
  assert.equal(opencode.provider.cheapbuddy.npm, '@ai-sdk/openai-compatible');
  assert.equal(opencode.provider.cheapbuddy.options.baseURL, 'https://api.cheapbuddy.cc/v1');
  assert.equal(opencode.provider.cheapbuddy.models['claude-opus-5-5'].interleaved, undefined);
  const codex = createPlatformArtifact('codex', claudeOptions);
  assert.match(codex.content, /wire_api = "responses"/);
  assert.match(codex.content, /model_provider = "cheapbuddy"/);
  assert.match(codex.content, /\[model_providers\.cheapbuddy\]/);
  assert.equal(codex.apiKey, generatedApiKey);
  assert.deepEqual(codex.mediaModels, []);
});

test('a Fable-only Claude config does not invent Opus, Sonnet or Haiku role aliases', () => {
  const model = { ...claudeModels[0], id: 'claude-fable-5-1', family: 'fable' };
  const config = JSON.parse(createPlatformArtifact('claude', { ...claudeOptions, models: [model] }).content);
  assert.equal(config.env.ANTHROPIC_MODEL, model.id);
  assert.equal(config.env.ANTHROPIC_DEFAULT_FABLE_MODEL, model.id);
  assert.equal(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
  assert.equal(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL, undefined);
  assert.equal(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined);
});

test('generates mixed Claude and OpenAI selections with one shared key for every client', () => {
  const mixedModels = [modelCatalog.find(({ id }) => id === 'gpt-6.1-sol'), claudeModels[0]];
  for (const { id } of platformOptions) {
    if (id === 'claude') {
      assert.throws(() => createPlatformArtifact(id, { ...options, models: mixedModels }), /Claude Code requires Claude models/i);
      continue;
    }
    const artifact = createPlatformArtifact(id, { ...options, models: mixedModels });
    assert.equal(artifact.apiKey, generatedApiKey);
    assert.equal(artifact.defaultModelId, mixedModels[0].id);
    for (const model of mixedModels) assert.ok(artifact.content.includes(model.id));
    if (id === 'workbuddy') {
      const config = JSON.parse(artifact.content);
      assert.deepEqual(config.models.map(({ apiKey }) => apiKey), [generatedApiKey, generatedApiKey]);
      assert.ok(config.models.every(({ url }) => url.endsWith('/chat/completions')));
    }
    if (id === 'opencode') {
      const config = JSON.parse(artifact.content);
      assert.equal(config.provider.cheapbuddy.options.apiKey, generatedApiKey);
      assert.deepEqual(Object.keys(config.provider.cheapbuddy.models), mixedModels.map(({ id }) => id));
    }
  }
});

test('OpenCode can choose native Anthropic without changing the base URL or key', () => {
  const config = JSON.parse(createPlatformArtifact('opencode', { ...claudeOptions, protocol: 'anthropic' }).content);
  assert.equal(config.provider.cheapbuddy.npm, '@ai-sdk/anthropic');
  assert.equal(config.provider.cheapbuddy.options.baseURL, 'https://api.cheapbuddy.cc/v1');
  assert.equal(config.provider.cheapbuddy.options.apiKey, generatedApiKey);
  assert.equal(config.model, 'cheapbuddy/claude-opus-5-5');
  assert.equal(config.provider.cheapbuddy.models['claude-opus-5-5'].interleaved, undefined);
});

test('Claude Code preserves the provided root or v1 base URL rather than replacing it', () => {
  for (const baseUrl of ['https://api.cheapbuddy.cc', 'https://api.cheapbuddy.cc/v1', 'https://api.cheapbuddy.cc/v1/v1/']) {
    const artifact = createPlatformArtifact('claude', { ...claudeOptions, baseUrl });
    const config = JSON.parse(artifact.content);
    assert.equal(config.env.ANTHROPIC_BASE_URL, baseUrl.replace(/\/+$/, ''));
    assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, generatedApiKey);
    assert.doesNotMatch(buildInstallPrompt(artifact, 'en'), /without.*\/v1|strip.*\/v1/);
  }
});

test('native OpenCode splits mixed adapters while sharing the key and preserving the default model', () => {
  const openai = modelCatalog.find(({ id }) => id === 'gpt-6.1-sol');
  for (const mixedModels of [[claudeModels[0], openai], [openai, claudeModels[0]]]) {
    const artifact = createPlatformArtifact('opencode', { ...options, models: mixedModels, protocol: 'anthropic' });
    const config = JSON.parse(artifact.content);
    assert.equal(config.provider.cheapbuddy.npm, '@ai-sdk/openai-compatible');
    assert.equal(config.provider['cheapbuddy-anthropic'].npm, '@ai-sdk/anthropic');
    for (const provider of Object.values(config.provider)) {
      assert.equal(provider.options.apiKey, generatedApiKey);
      assert.equal(provider.options.baseURL, 'https://api.cheapbuddy.cc/v1');
    }
    assert.deepEqual(Object.keys(config.provider.cheapbuddy.models), [openai.id]);
    assert.deepEqual(Object.keys(config.provider['cheapbuddy-anthropic'].models), [claudeModels[0].id]);
    const defaultProvider = mixedModels[0] === openai ? 'cheapbuddy' : 'cheapbuddy-anthropic';
    assert.equal(config.model, `${defaultProvider}/${mixedModels[0].id}`);
  }
});

test('connection probes follow the selected client protocol without unsupported Claude temperature', () => {
  for (const [platformId, protocol, endpoint] of [
    ['workbuddy', undefined, '/chat/completions'], ['claude', undefined, '/messages'],
    ['opencode', undefined, '/chat/completions'], ['opencode', 'anthropic', '/messages'],
    ['codex', undefined, '/responses'],
  ]) {
    const request = platformHelpers.buildConnectionTestRequest(platformId, { baseUrl: options.baseUrl, model: claudeModels[0], protocol });
    assert.equal(request.url, `https://api.cheapbuddy.cc/v1${endpoint}`);
    assert.equal(request.body.model, claudeModels[0].id);
    assert.equal(request.body.temperature, undefined);
    assert.equal(request.body.stream, false);
    assert.equal(request.isValid({}), false);
  }

  const glm53 = modelCatalog.find(({ id }) => id === 'glm-5.3');
  assert.throws(
    () => platformHelpers.buildConnectionTestRequest('claude', { baseUrl: options.baseUrl, model: glm53 }),
    /Claude Code requires Claude models/i,
  );
});

test('connection probes use the selected model temperature for provider-specific constraints', () => {
  const kimi = modelCatalog.find(({ id }) => id === 'kimi-k3');
  const request = platformHelpers.buildConnectionTestRequest('workbuddy', { baseUrl: options.baseUrl, model: kimi });

  assert.equal(request.url, 'https://api.cheapbuddy.cc/v1/chat/completions');
  assert.equal(request.body.model, 'kimi-k3');
  assert.equal(request.body.temperature, 1);
});

test('Claude Code only offers Claude models that use Anthropic Messages', () => {
  const claudeModelsForPlatform = platformHelpers.getModelsForPlatform('claude', modelCatalog);
  const glm53 = modelCatalog.find(({ id }) => id === 'glm-5.3');

  assert.ok(claudeModelsForPlatform.length > 0);
  assert.ok(claudeModelsForPlatform.every(({ protocols }) => protocols?.includes('anthropic')));
  assert.ok(platformHelpers.getModelsForPlatform('workbuddy', modelCatalog).some(({ id }) => id === 'glm-5.3'));
  for (const platformId of ['workbuddy', 'opencode']) {
    const request = platformHelpers.buildConnectionTestRequest(platformId, { baseUrl: options.baseUrl, model: glm53 });
    assert.equal(request.url, 'https://api.cheapbuddy.cc/v1/chat/completions');
  }
  assert.throws(() => platformHelpers.getModelsForPlatform('unknown', modelCatalog), /platform/i);
});

test('native connection probes keep non-Claude mixed-selection models on compatible OpenCode', () => {
  const request = platformHelpers.buildConnectionTestRequest('opencode', { baseUrl: options.baseUrl, model: selectedModels[0], protocol: 'anthropic' });
  assert.equal(request.url, 'https://api.cheapbuddy.cc/v1/chat/completions');
  assert.equal(request.isValid({ choices: [{ message: { content: 'OK' } }] }), true);
});

test('protocol metadata matches the actual client adapter and rejects unsupported overrides', () => {
  const compatible = createPlatformArtifact('opencode', { ...options, protocol: 'anthropic' });
  assert.equal(compatible.protocol, 'openai-compatible');
  for (const [id, protocol] of [['workbuddy', 'anthropic'], ['codex', 'anthropic'], ['claude', 'openai-compatible']]) {
    assert.throws(() => createPlatformArtifact(id, { ...claudeOptions, protocol }), /protocol/i);
  }
  assert.throws(() => createPlatformArtifact('opencode', { ...claudeOptions, protocol: 'invalid' }), /protocol/i);
});

test('connection probe validators accept only the corresponding model response shape', () => {
  const make = (id, model = claudeModels[0]) => platformHelpers.buildConnectionTestRequest(id, { baseUrl: options.baseUrl, model });
  assert.equal(make('claude').isValid({ content: [{ type: 'text', text: 'OK' }] }), true);
  assert.equal(make('codex').isValid({ output: [{ type: 'message' }] }), true);
  assert.equal(make('workbuddy').isValid({ choices: [] }), false);
  const media = make('workbuddy', { id: 'gpt-image-2.5', modality: 'image' });
  assert.equal(media.method, 'GET');
  assert.equal(media.body, undefined);
  assert.equal(media.isValid({ data: [{ id: 'gpt-image-2.5' }] }), true);
  assert.equal(media.isValid({ data: [{ id: 'different-model' }] }), false);
  assert.throws(() => make('unknown'), /platform/i);
  assert.throws(() => platformHelpers.buildConnectionTestRequest('claude', {}), /model/i);
});

test('each of the exact six Claude IDs is preserved by all four generators', () => {
  const claude = modelCatalog.filter(({ id }) => id.startsWith('claude-'));
  assert.equal(claude.length, 6);
  for (const model of claude) {
    for (const { id } of platformOptions) {
      const artifact = createPlatformArtifact(id, { ...claudeOptions, models: [model] });
      assert.equal(artifact.defaultModelId, model.id);
      assert.ok(artifact.content.includes(model.id));
      assert.deepEqual(artifact.mediaModels, []);
    }
  }
});
