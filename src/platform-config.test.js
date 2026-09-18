import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInstallPrompt, createPlatformArtifact, platformOptions } from './platform-config.js';

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
  id: 'grok-4.6',
  short: 'Grok 4.6',
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
  assert.deepEqual(platformOptions.map(({ maxModels }) => maxModels), [null, 2, null, 1]);
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
  const artifact = createPlatformArtifact('claude', options);
  const config = JSON.parse(artifact.content);

  assert.equal(artifact.filename, 'settings.json');
  assert.equal(artifact.configPath, '~/.claude/settings.json');
  assert.equal(config.env.ANTHROPIC_BASE_URL, 'https://api.cheapbuddy.cc');
  assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, options.apiKey);
  assert.equal(config.env.ANTHROPIC_MODEL, 'glm-5.2');
  assert.equal(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'MiniMax-M3');
  assert.equal(config.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
  assert.match(buildInstallPrompt(artifact), /ANTHROPIC_BASE_URL.*不带.*\/v1/);
});

test('builds an OpenCode provider with all selected models', () => {
  const artifact = createPlatformArtifact('opencode', options);
  const config = JSON.parse(artifact.content);
  const provider = config.providers.cheapbuddy;

  assert.equal(artifact.filename, 'opencode.json');
  assert.equal(artifact.configPath, '~/.config/opencode/opencode.json');
  assert.equal(config.model, 'cheapbuddy/glm-5.2');
  assert.equal(provider.package, '@opencode-ai/ai/providers/openai-compatible');
  assert.equal(provider.settings.baseURL, 'https://api.cheapbuddy.cc/v1');
  assert.equal(provider.settings.apiKey, options.apiKey);
  assert.deepEqual(Object.keys(provider.models), ['glm-5.2', 'MiniMax-M3']);
  assert.equal(provider.models['glm-5.2'].modelID, 'glm-5.2');
  assert.deepEqual(provider.models['glm-5.2'].capabilities, {
    tools: true,
    input: ['text'],
    output: ['text'],
  });
  assert.deepEqual(provider.models['glm-5.2'].compatibility, { reasoningField: 'reasoning_content' });
  assert.deepEqual(provider.models['MiniMax-M3'].capabilities.input, ['text', 'image']);
  assert.match(buildInstallPrompt(artifact), /providers.*package.*settings/);
  assert.match(buildInstallPrompt(artifact, 'en'), /legacy.*provider.*npm.*options/);
});

test('builds a Codex Responses API provider with the first model as default', () => {
  const artifact = createPlatformArtifact('codex', { ...options, models: [selectedModels[0]] });

  assert.equal(artifact.filename, 'config.toml');
  assert.equal(artifact.configPath, '~/.codex/config.toml');
  assert.match(artifact.content, /^model = "glm-5\.2"/m);
  assert.match(artifact.content, /^model_provider = "cheapbuddy"/m);
  assert.match(artifact.content, /^base_url = "https:\/\/api\.cheapbuddy\.cc\/v1"/m);
  assert.match(artifact.content, /^wire_api = "responses"/m);
  assert.match(artifact.content, /^env_key = "CHEAPBUDDY_API_KEY"/m);
  assert.doesNotMatch(artifact.content, /experimental_bearer_token/);
  assert.match(buildInstallPrompt(artifact, 'en'), new RegExp(`CHEAPBUDDY_API_KEY.*${generatedApiKey}`, 's'));
  assert.match(buildInstallPrompt(artifact, 'en'), /user-level.*config\.toml/);
});

test('keeps Grok 4.6 in generated platform configurations', () => {
  const grokOptions = { ...options, models: [grokModel] };

  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', grokOptions).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', grokOptions).content);
  const claude = JSON.parse(createPlatformArtifact('claude', grokOptions).content);
  const codex = createPlatformArtifact('codex', grokOptions).content;

  assert.equal(workbuddy.models[0].id, 'grok-4.6');
  assert.equal(workbuddy.models[0].maxInputTokens, 500000);
  assert.equal(opencode.providers.cheapbuddy.models['grok-4.6'].limit.context, 500000);
  assert.equal(claude.env.ANTHROPIC_MODEL, 'grok-4.6');
  assert.match(codex, /^model = "grok-4\.6"/m);
});

test('keeps GPT-6 Astra in every generated platform configuration', () => {
  const astraOptions = { ...options, models: [gpt6AstraModel] };

  const workbuddy = JSON.parse(createPlatformArtifact('workbuddy', astraOptions).content);
  const opencode = JSON.parse(createPlatformArtifact('opencode', astraOptions).content);
  const claude = JSON.parse(createPlatformArtifact('claude', astraOptions).content);
  const codex = createPlatformArtifact('codex', astraOptions).content;

  assert.equal(workbuddy.models[0].id, 'gpt-6-astra');
  assert.equal(workbuddy.models[0].name, 'CheapBuddy');
  assert.equal(opencode.providers.cheapbuddy.models['gpt-6-astra'].modelID, 'gpt-6-astra');
  assert.equal(opencode.providers.cheapbuddy.models['gpt-6-astra'].limit.context, 1050000);
  assert.equal(claude.env.ANTHROPIC_MODEL, 'gpt-6-astra');
  assert.match(codex, /^model = "gpt-6-astra"/m);
});

test('rejects invalid generator inputs', () => {
  assert.throws(() => createPlatformArtifact('codex', { ...options, models: [] }), /model/i);
  assert.throws(() => createPlatformArtifact('unknown', options), /platform/i);
  assert.throws(() => createPlatformArtifact('codex', { ...singleModelOptions, baseUrl: 'not a URL' }), /URL/i);
  assert.throws(() => createPlatformArtifact('codex', { ...singleModelOptions, baseUrl: 'http://api.cheapbuddy.cc/v1' }), /HTTPS/i);
  assert.throws(() => createPlatformArtifact('codex', { ...singleModelOptions, models: [{ ...selectedModels[0], maxInputTokens: 0 }] }), /maxInputTokens/i);
  assert.throws(() => createPlatformArtifact('workbuddy', { ...options, models: [selectedModels[0], { ...selectedModels[0] }] }), /Duplicate/i);
  assert.throws(() => createPlatformArtifact('codex', options), /at most 1/i);
  assert.throws(() => createPlatformArtifact('claude', { ...options, models: [...selectedModels, { ...selectedModels[0], id: 'third-model' }] }), /at most 2/i);
});

test('allows a local HTTP gateway during development', () => {
  const artifact = createPlatformArtifact('workbuddy', { ...options, baseUrl: 'http://127.0.0.1:8080/v1' });
  assert.match(artifact.content, /http:\/\/127\.0\.0\.1:8080\/v1\/chat\/completions/);
});
