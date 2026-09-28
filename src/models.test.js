import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeModels, modelCatalog } from './models.js';

test('model catalog contains unique ids and generator metadata', () => {
  const ids = modelCatalog.map((model) => model.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('grok-4.7'));
  assert.ok(ids.includes('gpt-6-astra'));
  assert.ok(ids.includes('gpt-6-sol'));
  assert.ok(ids.includes('gpt-6-luna'));
  assert.ok(ids.includes('gpt-5.6-sol'));
  assert.ok(ids.includes('gpt-5.6-terra'));
  assert.ok(ids.includes('deepseek/deepseek-v4.1-flash'));
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
    Object.fromEntries(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra'].map((id) => {
      const model = modelCatalog.find((item) => item.id === id);
      return [id, { input: model.input, output: model.output, maxInputTokens: model.maxInputTokens, maxOutputTokens: model.maxOutputTokens }];
    })),
    {
      'gpt-6-astra': { input: '$10.00', output: '$50.00', maxInputTokens: 1050000, maxOutputTokens: 128000 },
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
    'gpt-6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'deepseek/deepseek-v4.1-flash',
    'qwen3.8-max',
    'gpt-image-2.5',
    'MiniMax-H3',
  ]));
});

test('verified token rates use official values and unavailable rates stay explicit', () => {
  const expected = {
    'gpt-6-sol': ['$2.00', '$10.00'],
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
