import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeModels, modelCatalog } from './models.js';
import { CLAUDE_API_KEY_GROUP_ID, getModelApiKeyGroupId } from './key-groups.js';

test('model catalog contains unique ids and generator metadata', () => {
  const ids = modelCatalog.map((model) => model.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(modelCatalog.every((model) => !Object.prototype.hasOwnProperty.call(model, 'providerModelId')));
  assert.ok(ids.includes('grok-4.7'));
  assert.ok(ids.includes('gpt-6-astra'));
  assert.ok(ids.includes('gpt-6-sol'));
  assert.ok(ids.includes('gpt-6.1-sol'));
  assert.ok(ids.includes('gpt-6-luna'));
  assert.ok(ids.includes('gpt-5.6-sol'));
  assert.ok(ids.includes('gpt-5.6-terra'));
  assert.ok(ids.includes('deepseek-flash'));
  assert.ok(!ids.includes('deepseek/deepseek-v4.1-flash'));
  assert.ok(ids.includes('deepseek-v4.1-flash-1017'));
  assert.ok(ids.includes('gpt-image-2.5'));
  assert.ok(ids.includes('MiniMax-H3'));
  assert.ok(ids.includes('glm-5.3'));
  assert.ok(ids.includes('glm-5.3-flash'));
  assert.ok(ids.includes('qwen3.8-max'));
  const glm53 = modelCatalog.find((model) => model.id === 'glm-5.3');
  assert.equal(glm53.short, 'GLM 5.3');
  assert.equal(glm53.supportsToolCall, true);
  assert.equal(glm53.maxInputTokens, 1000000);
  assert.deepEqual(
    Object.fromEntries(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-5.6-sol', 'gpt-5.6-terra'].map((id) => {
      const model = modelCatalog.find((item) => item.id === id);
      return [id, { input: model.input, output: model.output, maxInputTokens: model.maxInputTokens, maxOutputTokens: model.maxOutputTokens }];
    })),
    {
      'gpt-6-astra': { input: '$10.00', output: '$50.00', maxInputTokens: 1050000, maxOutputTokens: 128000 },
      'gpt-6.1-sol': { input: '$2.00', output: '$10.00', maxInputTokens: 922000, maxOutputTokens: 128000 },
      'gpt-5.6-sol': { input: '$4.00', output: '$20.00', maxInputTokens: 1050000, maxOutputTokens: 128000 },
      'gpt-5.6-terra': { input: '$2.00', output: '$12.00', maxInputTokens: 1050000, maxOutputTokens: 128000 },
    },
  );
  for (const model of modelCatalog) {
    assert.ok(model.short);
    assert.ok(model.vendor.zh);
    assert.ok(model.vendor.en);
    assert.ok(model.description.zh);
    assert.ok(model.description.en);
    assert.ok(Number.isSafeInteger(model.maxInputTokens) && model.maxInputTokens > 0);
    assert.ok(Number.isSafeInteger(model.maxOutputTokens) && model.maxOutputTokens > 0);
  }
});

test('model catalog contains published text and media models', () => {
  const visibleModelIds = new Set(modelCatalog.map((model) => model.id));

  assert.deepEqual(visibleModelIds, new Set([
    'glm-5.3',
    'glm-5.3-flash',
    'kimi-k3',
    'grok-4.7',
    'gpt-6-astra',
    'gpt-6-sol',
    'gpt-6.1-sol',
    'gpt-6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'deepseek-flash',
    'deepseek-v4.1-flash-1017',
    'qwen3.8-max',
    'gpt-image-2.5',
    'MiniMax-H3',
    'claude-fable-5',
    'claude-fable-5-1',
    'claude-opus-5',
    'claude-opus-5-5',
    'claude-sonnet-5',
    'claude-sonnet-5-5',
  ]));
});

test('DeepSeek V4.1 Flash 1017 keeps its canonical ID and plain localized descriptions', () => {
  const deepseek = modelCatalog.find(({ id }) => id === 'deepseek-v4.1-flash-1017');
  assert.ok(deepseek);
  assert.equal(deepseek.short, 'DeepSeek V4.1 Flash 1017');

  for (const [language, description] of Object.entries({
    zh: '百万上下文、多模态理解与 Agent 工具调用',
    en: 'Million-token context, multimodal understanding, and Agent tool calling',
  })) {
    const [localized] = localizeModels([deepseek], language);
    assert.equal(localized.id, 'deepseek-v4.1-flash-1017');
    assert.equal(localized.description, description);
  }
});

test('DeepSeek Flash uses its stable public name in both languages', () => {
  for (const language of ['zh', 'en']) {
    const deepseek = localizeModels(modelCatalog, language).find(({ id }) => id === 'deepseek-flash');
    assert.ok(deepseek);
    assert.equal(deepseek.short, 'DeepSeek Flash');
  }
});

test('verified token rates use official values and unavailable rates stay explicit', () => {
  const expected = {
    'gpt-6-sol': ['$2.00', '$10.00'],
    'gpt-6.1-sol': ['$2.00', '$10.00'],
    'gpt-6-luna': ['$0.10', '$0.50'],
    'qwen3.8-max': ['¥12.00', '¥36.00'],
  };

  for (const [id, prices] of Object.entries(expected)) {
    const model = modelCatalog.find((item) => item.id === id);
    assert.equal(model.modality, 'text');
    assert.equal(model.endpointPath, '/chat/completions');
    assert.deepEqual([model.input, model.output], prices);
    assert.equal(model.priceStatus, 'verified');
  }

  for (const id of ['glm-5.3', 'glm-5.3-flash', 'kimi-k3']) {
    const model = modelCatalog.find((item) => item.id === id);
    assert.equal(model.priceStatus, 'unverified');
    assert.equal(model.input, '待核验');
    assert.equal(model.output, '待核验');
    assert.ok(model.priceSourceUrl);
  }
});

test('media models expose their native protocol and endpoint metadata', () => {
  const image = modelCatalog.find((model) => model.id === 'gpt-image-2.5');
  const video = modelCatalog.find((model) => model.id === 'MiniMax-H3');

  assert.equal(image.modality, 'image');
  assert.equal(image.endpointPath, '/images/generations');
  assert.equal(image.supportsImages, true);
  assert.equal(video.modality, 'video');
  assert.equal(video.endpointPath, '/videos');
  assert.equal(video.supportsToolCall, false);
});

test('localization is derived from the catalog without translation-key edits', () => {
  const zh = localizeModels(modelCatalog, 'zh');
  const en = localizeModels(modelCatalog, 'en');
  const grokZh = zh.find((model) => model.id === 'grok-4.7');
  const grokEn = en.find((model) => model.id === 'grok-4.7');

  assert.equal(grokZh.vendor, 'xAI');
  assert.equal(grokZh.description, '代码、Agent 与知识工作');
  assert.equal(grokEn.vendor, 'xAI');
  assert.equal(grokEn.description, 'Coding, Agent workflows, and knowledge work');
  assert.match(grokZh.priceUnit, /缓存/);
  assert.match(grokEn.priceUnit, /cached input/);
});

test('converts verified USD prices to CNY in Chinese without mutating the catalog', () => {
  const grok = modelCatalog.find((model) => model.id === 'grok-4.7');
  const localized = localizeModels([grok], 'zh')[0];

  assert.equal(localized.input, '¥13.00–¥26.00');
  assert.equal(localized.output, '¥39.00–¥78.00');
  assert.match(localized.priceUnit, /人民币/);
  assert.match(localized.priceUnit, /¥3.25/);
  assert.match(localized.priceUnit, /1 USD = 6.5 CNY/);
  assert.equal(grok.input, '$2.00–$4.00');
});

test('converts CNY prices and small price ranges to USD in English', () => {
  const qwen = modelCatalog.find((model) => model.id === 'qwen3.8-max');
  const deepseek = modelCatalog.find((model) => model.id === 'deepseek-flash');
  assert.equal(deepseek.providerModelId, undefined);
  const [qwenEn, deepseekEn] = localizeModels([qwen, deepseek], 'en');

  assert.equal(qwenEn.input, '$1.8462');
  assert.equal(qwenEn.output, '$5.5385');
  assert.match(qwenEn.priceUnit, /USD \/ MTok/);
  assert.match(qwenEn.priceUnit, /\$0.2308/);
  assert.match(qwenEn.priceUnit, /1 USD = 6.5 CNY/);
  assert.equal(deepseekEn.input, '$0.0031–$0.0062 cached · $0.1538–$0.3077 uncached');
  assert.equal(deepseekEn.output, '$0.6154–$1.2308');
  assert.equal(deepseek.input, '¥0.02–¥0.04 缓存 · ¥1–¥2 未缓存');
});

test('keeps unverified and non-priced models unchanged', () => {
  const unverified = modelCatalog.find((model) => model.id === 'glm-5.3');
  const image = modelCatalog.find((model) => model.id === 'gpt-image-2.5');
  const [unverifiedEn, imageZh] = localizeModels([unverified, image], 'en');
  const imageChinese = localizeModels([image], 'zh')[0];

  assert.equal(unverifiedEn.input, '待核验');
  assert.equal(unverifiedEn.output, '待核验');
  assert.equal(unverifiedEn.priceUnit, 'Official rate not verified');
  assert.equal(imageZh.input, '按任务');
  assert.equal(imageZh.output, '按图片');
  assert.equal(imageChinese.input, '按任务');
  assert.equal(imageChinese.output, '按图片');
});

test('localizes native currency and time units for media pricing', () => {
  const video = modelCatalog.find((model) => model.id === 'MiniMax-H3');
  const [videoZh, videoEn] = [localizeModels([video], 'zh')[0], localizeModels([video], 'en')[0]];

  assert.equal(videoZh.input, '¥0.52 / 秒');
  assert.match(videoZh.priceUnit, /2K 官网价 ¥0.845\/秒/);
  assert.equal(videoEn.input, '$0.08 / sec');
  assert.match(videoEn.priceUnit, /2K is \$0.13\/sec/);
});

test('publishes exactly the six production Claude stable models with official cache rates', () => {
  const expected = {
    'claude-fable-5': [10, 50, 12.5, 20, 1],
    'claude-fable-5-1': [10, 50, 12.5, 20, 0.25],
    'claude-opus-5': [5, 25, 6.25, 10, 0.5],
    'claude-opus-5-5': [4, 20, 5, 8, 0.2],
    'claude-sonnet-5': [2, 10, 2.5, 4, 0.2],
    'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.1],
  };
  const claudeModels = modelCatalog.filter(({ id }) => id.startsWith('claude-'));
  assert.deepEqual(claudeModels.map(({ id }) => id), Object.keys(expected));
  for (const model of claudeModels) {
    const rates = model.officialPricing;
    assert.deepEqual([rates.input, rates.output, rates.cacheWrite5m, rates.cacheWrite1h, rates.cacheRead], expected[model.id]);
    assert.equal(model.pricingScope, 'sub2api-group');
    assert.equal(model.priceStatus, 'verified');
    assert.equal(model.priceCheckedAt, '2026-10-13');
    assert.equal(model.priceSourceUrl, 'https://platform.claude.com/docs/en/about-claude/pricing');
    assert.equal(model.channelId, 'claude');
    assert.equal(model.modality, 'text');
    assert.equal(model.endpointPath, '/messages');
    assert.equal(model.vendor.en, 'Anthropic');
  }
});

test('Claude models advertise two alternative protocols and resolve to the Claude key group', () => {
  const claude = modelCatalog.filter(({ id }) => id.startsWith('claude-'));
  assert.equal(claude.length, 6);
  for (const model of claude) {
    assert.deepEqual(model.protocols, ['anthropic', 'openai-compatible']);
    assert.equal(model.apiKeyGroupId, undefined);
    assert.equal(getModelApiKeyGroupId(model), CLAUDE_API_KEY_GROUP_ID);
  }
  const openai = modelCatalog.find(({ id }) => id === 'gpt-6-sol');
  assert.equal(openai.priceMultiplier, 0.72);
});

test('Claude cache prices remain official reference values without a global retail overlay', () => {
  const sonnet = modelCatalog.find(({ id }) => id === 'claude-sonnet-5-5');
  assert.ok(sonnet);
  const [zh, en] = [localizeModels([sonnet], 'zh')[0], localizeModels([sonnet], 'en')[0]];
  assert.equal(en.input, '$2.00');
  assert.equal(en.retailInput, undefined);
  assert.equal(en.retailOutput, undefined);
  assert.match(en.priceUnit, /5m.*\$2.50.*1h.*\$4.00.*read.*\$0.10/);
  assert.equal(en.retailPriceUnit, undefined);
  assert.equal(zh.retailInput, undefined);
  assert.equal(zh.retailPriceUnit, undefined);
  assert.equal(sonnet.officialPricing.cacheRead, 0.1);
});

test('Claude catalog does not publish a global customer multiplier', () => {
  for (const model of modelCatalog.filter(({ id }) => id.startsWith('claude-'))) {
    const localized = localizeModels([model], 'en')[0];
    const numbers = (text) => [...text.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    const rates = Object.values(model.officialPricing);
    assert.deepEqual(numbers(`${localized.input} ${localized.output} ${localized.priceUnit}`), rates);
    assert.equal(localized.retailInput, undefined);
    assert.equal(localized.retailOutput, undefined);
    assert.equal(model.priceMultiplier, undefined);
    assert.equal(model.pricingScope, 'sub2api-group');
  }
});
