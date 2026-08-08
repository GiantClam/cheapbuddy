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

test('publishes every supported target platform', () => {
  assert.deepEqual(platformOptions.map(({ id }) => id), ['workbuddy', 'claude', 'opencode', 'codex']);
});

test('builds the existing WorkBuddy models file', () => {
  const artifact = createPlatformArtifact('workbuddy', options);
  const config = JSON.parse(artifact.content);

  assert.equal(artifact.filename, 'models.json');
  assert.equal(artifact.configPath, '~/.workbuddy/models.json');
  assert.equal(config.models.length, 2);
  assert.equal(config.models[0].url, 'https://api.cheapbuddy.cc/v1/chat/completions');
  assert.equal(config.models[0].apiKey, options.apiKey);
});

test('builds a Claude Code user gateway config using the Messages endpoint base', () => {
  const artifact = createPlatformArtifact('claude', options);
  const config = JSON.parse(artifact.content);

  assert.equal(artifact.filename, 'settings.json');
  assert.equal(artifact.configPath, '~/.claude/settings.json');
  assert.equal(config.env.ANTHROPIC_BASE_URL, 'https://api.cheapbuddy.cc');
  assert.equal(config.env.ANTHROPIC_AUTH_TOKEN, options.apiKey);
  assert.equal(config.env.ANTHROPIC_MODEL, 'glm-5.2');
  assert.equal(config.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
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
});

test('builds a Codex Responses API provider with the first model as default', () => {
  const artifact = createPlatformArtifact('codex', options);

  assert.equal(artifact.filename, 'config.toml');
  assert.equal(artifact.configPath, '~/.codex/config.toml');
  assert.match(artifact.content, /^model = "glm-5\.2"/m);
  assert.match(artifact.content, /^model_provider = "cheapbuddy"/m);
  assert.match(artifact.content, /^base_url = "https:\/\/api\.cheapbuddy\.cc\/v1"/m);
  assert.match(artifact.content, /^wire_api = "responses"/m);
  assert.match(artifact.content, /^env_key = "CHEAPBUDDY_API_KEY"/m);
  assert.doesNotMatch(artifact.content, /experimental_bearer_token/);
  assert.match(buildInstallPrompt(artifact, 'en'), new RegExp(`CHEAPBUDDY_API_KEY.*${generatedApiKey}`, 's'));
});

test('rejects invalid generator inputs', () => {
  assert.throws(() => createPlatformArtifact('codex', { ...options, models: [] }), /model/i);
  assert.throws(() => createPlatformArtifact('unknown', options), /platform/i);
  assert.throws(() => createPlatformArtifact('codex', { ...options, baseUrl: 'not a URL' }), /URL/i);
  assert.throws(() => createPlatformArtifact('codex', { ...options, baseUrl: 'http://api.cheapbuddy.cc/v1' }), /HTTPS/i);
  assert.throws(() => createPlatformArtifact('codex', { ...options, models: [{ ...selectedModels[0], maxInputTokens: 0 }] }), /maxInputTokens/i);
  assert.throws(() => createPlatformArtifact('codex', { ...options, models: [selectedModels[0], { ...selectedModels[0] }] }), /Duplicate/i);
});

test('allows a local HTTP gateway during development', () => {
  const artifact = createPlatformArtifact('workbuddy', { ...options, baseUrl: 'http://127.0.0.1:8080/v1' });
  assert.match(artifact.content, /http:\/\/127\.0\.0\.1:8080\/v1\/chat\/completions/);
});
