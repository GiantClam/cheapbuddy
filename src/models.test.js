import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeModels, modelCatalog } from './models.js';

test('model catalog contains unique ids and generator metadata', () => {
  const ids = modelCatalog.map((model) => model.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('grok-4.6'));
  assert.ok(ids.includes('gpt-6-astra'));
  assert.ok(ids.includes('gpt-5.6-sol'));
  assert.ok(ids.includes('gpt-5.6-terra'));
  assert.ok(ids.includes('deepseek/deepseek-v4-flash'));
  assert.ok(ids.includes('glm-5.3'));
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
      'gpt-5.6-sol': { input: '$5.00', output: '$30.00', maxInputTokens: 1050000, maxOutputTokens: 128000 },
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

test('model catalog contains only production-verified text models', () => {
  const visibleModelIds = new Set(modelCatalog.map((model) => model.id));

  assert.deepEqual(visibleModelIds, new Set([
    'glm-5.3',
    'kimi-k3',
    'grok-4.6',
    'gpt-6-astra',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'deepseek/deepseek-v4-flash',
  ]));
});

test('localization is derived from the catalog without translation-key edits', () => {
  const zh = localizeModels(modelCatalog, 'zh');
  const en = localizeModels(modelCatalog, 'en');
  const grokZh = zh.find((model) => model.id === 'grok-4.6');
  const grokEn = en.find((model) => model.id === 'grok-4.6');

  assert.equal(grokZh.vendor, 'xAI');
  assert.equal(grokZh.description, '代码、Agent 与知识工作');
  assert.equal(grokEn.vendor, 'xAI');
  assert.equal(grokEn.description, 'Coding, Agent workflows, and knowledge work');
});
