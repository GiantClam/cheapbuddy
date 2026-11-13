import test from 'node:test';
import assert from 'node:assert/strict';
import { getHomepageFeaturedModels, getHomepageModels, isModelRecentlyLaunched, localizeModels, modelCatalog } from './models.js';
import { CLAUDE_API_KEY_GROUP_ID, getModelApiKeyGroupId } from './key-groups.js';

test('model catalog contains unique ids and generator metadata', () => {
  const ids = modelCatalog.map((model) => model.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(modelCatalog.every((model) => !Object.prototype.hasOwnProperty.call(model, 'providerModelId')));
  assert.ok(ids.includes('grok-4.7'));
  assert.ok(ids.includes('gpt-6-astra'));
  assert.ok(ids.includes('gpt-6-sol'));
  assert.ok(ids.includes('gpt-6.1-sol'));
  assert.ok(ids.includes('gpt-6.1-terra'));
  assert.ok(ids.includes('gpt-6-luna'));
  assert.ok(ids.includes('kimi-k3.1-pro'));
  assert.ok(ids.includes('gpt-5.6-sol'));
  assert.ok(ids.includes('gpt-5.6-terra'));
  assert.ok(ids.includes('deepseek-flash'));
  assert.ok(!ids.includes('deepseek/deepseek-v4.1-flash'));
  assert.ok(ids.includes('deepseek-v4.1-flash-1017'));
  assert.ok(ids.includes('gpt-image-2.5'));
  assert.ok(ids.includes('gpt-image-2.6'));
  assert.ok(ids.includes('MiniMax-H3'));
  assert.ok(ids.includes('glm-5.3'));
  assert.ok(ids.includes('glm-5.3-flash'));
  assert.ok(ids.includes('qwen3.8-max'));
  assert.ok(ids.includes('jev-latest'));
  assert.ok(ids.includes('gemini-4-argon'));
  assert.ok(ids.includes('gemini-4-argon-high'));
  assert.ok(ids.includes('gemini-4-argon-low'));
  assert.ok(ids.includes('gemini-4-argon-medium'));
  const glm53 = modelCatalog.find((model) => model.id === 'glm-5.3');
  assert.equal(glm53.short, 'GLM 5.3');
  assert.equal(glm53.supportsToolCall, true);
  assert.equal(glm53.maxInputTokens, 1000000);
  const deepseek = modelCatalog.find(({ id }) => id === 'deepseek-v4.1-flash-1017');
  assert.deepEqual([deepseek.input, deepseek.output], ['$0.003–$0.006 cached · $0.15–$0.30 uncached', '$0.60–$1.20']);
  assert.equal(deepseek.priceCheckedAt, '2026-10-29');
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
    'gpt-6.1-terra',
    'gpt-6-luna',
    'kimi-k3.1-pro',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'deepseek-flash',
    'deepseek-v4.1-flash-1017',
    'qwen3.8-max',
    'jev-latest',
    'gemini-4-argon',
    'gemini-4-argon-high',
    'gemini-4-argon-low',
    'gemini-4-argon-medium',
    'gemini-4-carbon',
    'gpt-image-2.5',
    'gpt-image-2.6',
    'MiniMax-H3',
    'claude-fable-5',
    'claude-fable-5-2',
    'claude-fable-5-1',
    'claude-opus-5',
    'claude-opus-5-5',
    'claude-sonnet-5',
    'claude-sonnet-5-5',
    'claude-opus-5-5-MAX',
  ]));
});

test('publishes PPToken Gemini Argon variants as OpenAI-compatible text models', () => {
  const models = modelCatalog.filter(({ id }) => id.startsWith('gemini-4-argon'));

  assert.deepEqual(models.map(({ id }) => id), [
    'gemini-4-argon',
    'gemini-4-argon-high',
    'gemini-4-argon-low',
    'gemini-4-argon-medium',
  ]);
  for (const model of models) {
    assert.deepEqual(model.vendor, { zh: 'Google Gemini', en: 'Google Gemini' });
    assert.equal(model.modality, 'text');
    assert.equal(model.endpointPath, '/chat/completions');
    assert.equal(model.priceStatus, 'unverified');
    assert.equal(model.priceSourceUrl, 'https://api.pptoken.cc/');
    assert.equal(model.input, '待核验');
    assert.equal(model.output, '待核验');
    assert.equal(model.supportsImages, false);
  }
});

test('publishes PPToken Gemini Carbon as an OpenAI-compatible text model', () => {
  const model = modelCatalog.find(({ id }) => id === 'gemini-4-carbon');
  assert.ok(model);
  assert.deepEqual(model.vendor, { zh: 'Google Gemini', en: 'Google Gemini' });
  assert.equal(model.modality, 'text');
  assert.equal(model.endpointPath, '/chat/completions');
  assert.equal(model.priceStatus, 'verified');
  assert.equal(model.input, '$2.00');
  assert.equal(model.output, '$10.00');
  assert.equal(model.priceMultiplier, 0.6);
  assert.equal(model.supportsImages, false);
});

test('homepage model shelf only includes configurable public models', () => {
  const homepage = getHomepageModels(modelCatalog);
  assert.ok(homepage.some(({ id }) => id === 'gemini-4-carbon'));
  assert.ok(!homepage.some(({ id }) => id === 'jev-latest'));
});

test('DeepSeek V4.1 Flash 1017 keeps its canonical ID and plain localized descriptions', () => {
  const deepseek = modelCatalog.find(({ id }) => id === 'deepseek-v4.1-flash-1017');
  assert.ok(deepseek);
  assert.equal(deepseek.short, 'DeepSeek V4.1 Flash 1017');
  assert.equal(deepseek.seoPath, '/model/deepseek-v4-1-flash-1017/');
  assert.equal(deepseek.seoPathEn, '/en/model/deepseek-v4-1-flash-1017/');
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

test('homepage includes configurable models and excludes native System One models', () => {
  const homepageModels = getHomepageModels(modelCatalog);
  const homepageIds = homepageModels.map(({ id }) => id);
  const heroIds = getHomepageFeaturedModels(modelCatalog).map(({ id }) => id);

  assert.ok(homepageIds.includes('deepseek-v4.1-flash-1017'));
  assert.ok(homepageIds.includes('grok-4.7'));
  assert.ok(homepageIds.includes('gemini-4-carbon'));
  assert.ok(!homepageIds.includes('jev-latest'));
  assert.ok(heroIds.includes('deepseek-v4.1-flash-1017'));
  assert.ok(modelCatalog.some(({ id }) => id === 'grok-4.7'));
});

test('model SEO page links have localized alternates', () => {
  const opus = modelCatalog.find(({ id }) => id === 'claude-opus-5-5');
  const deepseek = modelCatalog.find(({ id }) => id === 'deepseek-v4.1-flash-1017');
  assert.equal(opus.seoPath, '/model/claude-opus-5-5/');
  assert.equal(opus.seoPathEn, '/en/model/claude-opus-5-5/');
  assert.equal(deepseek.seoPath, '/model/deepseek-v4-1-flash-1017/');
  assert.equal(deepseek.seoPathEn, '/en/model/deepseek-v4-1-flash-1017/');
  const image = modelCatalog.find(({ id }) => id === 'gpt-image-2.6');
  assert.equal(image.seoPath, '/model/gpt-image-2-6/');
  assert.equal(image.seoPathEn, '/en/model/gpt-image-2-6/');
  assert.equal(modelCatalog.filter((model) => model.seoPath).length, 3);
});

test('verified token rates use official values and unavailable rates stay explicit', () => {
  const expected = {
    'gpt-6-sol': ['$2.00', '$10.00'],
    'gpt-6.1-sol': ['$2.00', '$10.00'],
    'gpt-6.1-terra': ['$1.00', '$5.00'],
    'gpt-6-luna': ['$0.10', '$0.50'],
    'kimi-k3.1-pro': ['$2.00', '$10.00'],
    'qwen3.8-max': ['¥12.00', '¥36.00'],
  };

  for (const [id, prices] of Object.entries(expected)) {
    const model = modelCatalog.find((item) => item.id === id);
    assert.equal(model.modality, 'text');
    assert.equal(model.endpointPath, '/chat/completions');
    assert.deepEqual([model.input, model.output], prices);
    assert.equal(model.priceStatus, 'verified');
  }

  for (const id of ['glm-5.3', 'glm-5.3-flash',
    'gemini-4-argon', 'gemini-4-argon-high', 'gemini-4-argon-low', 'gemini-4-argon-medium']) {
    const model = modelCatalog.find((item) => item.id === id);
    assert.equal(model.priceStatus, 'unverified');
    assert.equal(model.input, '待核验');
    assert.equal(model.output, '待核验');
    assert.ok(model.priceSourceUrl);
  }
});

test('Kimi K3.1 Pro publishes verified official pricing and capability metadata', () => {
  const kimi = modelCatalog.find(({ id }) => id === 'kimi-k3.1-pro');
  assert.ok(kimi, 'Kimi K3.1 Pro must be selectable from the public catalog');
  assert.equal(kimi.short, 'Kimi K3.1 Pro');
  assert.deepEqual(kimi.vendor, { zh: 'Kimi', en: 'Kimi' });
  assert.equal(kimi.priceStatus, 'verified');
  assert.equal(kimi.priceSourceUrl, 'https://platform.kimi.ai/docs/pricing/chat');
  assert.equal(kimi.priceCheckedAt, '2026-10-29');
  assert.equal(kimi.priceMultiplier, 0.6);
  assert.equal(kimi.endpointPath, '/chat/completions');
  assert.deepEqual([kimi.maxInputTokens, kimi.maxOutputTokens], [1000000, 131072]);
  assert.deepEqual(
    [kimi.supportsToolCall, kimi.supportsImages, kimi.supportsReasoning, kimi.onlyReasoning],
    [true, true, true, true],
  );
  assert.match(kimi.description.en, /vision/i);
  assert.match(kimi.description.en, /agent/i);
  assert.match(kimi.description.zh, /视觉/);
  assert.match(kimi.priceUnit.en, /cache write \$2\.00/);
  assert.match(kimi.priceUnit.en, /cache read \$0\.20/);
  assert.match(kimi.priceUnit.zh, /缓存写入 \$2\.00/);
  assert.match(kimi.priceUnit.zh, /缓存读取 \$0\.20/);
  assert.ok(getHomepageModels().some(({ id }) => id === kimi.id));
});

test('Kimi K3.1 Pro localizes official and calculated customer rates separately', () => {
  const kimi = modelCatalog.find(({ id }) => id === 'kimi-k3.1-pro');
  const [en] = localizeModels([kimi], 'en');
  const [zh] = localizeModels([kimi], 'zh');

  assert.deepEqual([en.input, en.output, en.retailInput, en.retailOutput], ['$2.00', '$10.00', '$1.20', '$6.00']);
  assert.match(en.priceUnit, /cache write \$2\.00/);
  assert.match(en.retailPriceUnit, /cache write \$1\.20/);
  assert.deepEqual([zh.input, zh.output, zh.retailInput, zh.retailOutput], ['$2.00', '$10.00', '$1.20', '$6.00']);
  assert.match(zh.priceUnit, /缓存写入 \$2\.00/);
  assert.match(zh.retailPriceUnit, /缓存写入 \$1\.20/);
});

test('GPT-6.1 Terra publishes verified pricing, vision and reasoning metadata', () => {
  const terra = modelCatalog.find(({ id }) => id === 'gpt-6.1-terra');
  assert.ok(terra, 'GPT-6.1 Terra must be selectable from the public catalog');
  assert.equal(terra.short, 'GPT-6.1 Terra');
  assert.equal(terra.priceSourceUrl, 'https://developers.openai.com/api/docs/models/gpt-6.1-terra');
  assert.equal(terra.priceCheckedAt, '2026-10-29');
  assert.equal(terra.priceMultiplier, 0.6);
  assert.deepEqual([terra.maxInputTokens, terra.maxOutputTokens], [1050000, 128000]);
  assert.deepEqual(
    [terra.supportsToolCall, terra.supportsImages, terra.supportsReasoning, terra.onlyReasoning],
    [true, true, true, false],
  );
  assert.deepEqual(terra.reasoning, {
    effort: 'medium', defaultEffort: 'medium',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    summary: 'auto', canDisableThinking: true,
  });
  assert.match(terra.description.en, /vision/i);
  assert.match(terra.description.en, /computer use/i);
  assert.match(terra.description.zh, /视觉/);
  assert.match(terra.description.zh, /电脑操作/);
  assert.match(terra.priceUnit.en, /cache read \$0\.05/);
  assert.match(terra.priceUnit.en, /30m cache write \$1\.25/);
  assert.match(terra.priceUnit.en, /12h cache write \$2\.50/);
  assert.match(terra.priceUnit.en, /above 272K input tokens: input\/cache 2x, output 1\.5x/);
  assert.match(terra.priceUnit.zh, /缓存读取 \$0\.05/);
  assert.match(terra.priceUnit.zh, /30m 缓存写入 \$1\.25/);
  assert.match(terra.priceUnit.zh, /12h 缓存写入 \$2\.50/);
  assert.match(terra.priceUnit.zh, /超过 272K 输入 Token：输入及缓存价格 2 倍，输出价格 1\.5 倍/);
  assert.ok(getHomepageModels().some(({ id }) => id === terra.id));
});

test('GPT-6.1 Terra localizes official and inherited customer rates separately', () => {
  const terra = modelCatalog.find(({ id }) => id === 'gpt-6.1-terra');
  const [en] = localizeModels([terra], 'en');
  const [zh] = localizeModels([terra], 'zh');

  assert.deepEqual([en.input, en.output, en.retailInput, en.retailOutput], ['$1.00', '$5.00', '$0.60', '$3.00']);
  assert.match(en.priceUnit, /cache read \$0\.05, 30m cache write \$1\.25, 12h cache write \$2\.50/);
  assert.match(en.retailPriceUnit, /cache read \$0\.03, 30m cache write \$0\.75, 12h cache write \$1\.50/);
  assert.match(en.retailPriceUnit, /above 272K input tokens: input\/cache 2x, output 1\.5x/);
  assert.deepEqual([zh.input, zh.output, zh.retailInput, zh.retailOutput], ['$1.00', '$5.00', '$0.60', '$3.00']);
  assert.match(zh.priceUnit, /缓存读取 \$0\.05，30m 缓存写入 \$1\.25，12h 缓存写入 \$2\.50/);
  assert.match(zh.retailPriceUnit, /缓存读取 \$0\.03，30m 缓存写入 \$0\.75，12h 缓存写入 \$1\.50/);
  assert.deepEqual([terra.input, terra.output], ['$1.00', '$5.00']);
});

test('media models expose their native protocol and endpoint metadata', () => {
  const image = modelCatalog.find((model) => model.id === 'gpt-image-2.5');
  const imageNext = modelCatalog.find((model) => model.id === 'gpt-image-2.6');
  const video = modelCatalog.find((model) => model.id === 'MiniMax-H3');

  assert.equal(image.modality, 'image');
  assert.equal(image.endpointPath, '/images/generations');
  assert.equal(image.supportsImages, true);
  assert.equal(imageNext.modality, 'image');
  assert.equal(imageNext.endpointPath, '/images/generations');
  assert.equal(imageNext.supportsImages, true);
  assert.equal(video.modality, 'video');
  assert.equal(video.endpointPath, '/videos');
  assert.equal(video.supportsToolCall, false);
});

test('GPT Image models publish their API without presenting supplier cost as a retail price', () => {
  const baseline = modelCatalog.find((model) => model.id === 'gpt-image-2.5');
  const launched = modelCatalog.find((model) => model.id === 'gpt-image-2.6');
  const billingSurface = ({ input, output, priceStatus, priceUnit, billingUnit, modality, endpointPath }) => (
    { input, output, priceStatus, priceUnit, billingUnit, modality, endpointPath }
  );

  assert.deepEqual(billingSurface(launched), billingSurface(baseline));
  assert.equal(launched.short, 'GPT Image 2.6');
  assert.equal(launched.vendor.en, 'OpenAI');
  for (const model of [baseline, launched]) {
    assert.equal(model.showPricing, false);
    assert.equal(model.priceStatus, undefined);
    assert.equal(model.priceUnit, undefined);
    assert.doesNotMatch(`${model.input} ${model.output}`, /[$¥]|0\.10|0\.015384/);
  }
  // The homepage hero now promotes the verified 2.6 model while 2.5 remains available.
  assert.equal(launched.featured, true);
  assert.ok(getHomepageFeaturedModels().some(({ id }) => id === 'gpt-image-2.6'));
  assert.ok(getHomepageModels().some(({ id }) => id === 'gpt-image-2.6'));
});

test('the launch announcement and NEW badge expire 30 days after the China-local launch date', () => {
  const image = modelCatalog.find(({ id }) => id === 'gpt-image-2.6');
  assert.equal(isModelRecentlyLaunched(image, '2026-11-04T23:59:59+08:00'), false);
  assert.equal(isModelRecentlyLaunched(image, '2026-11-05T00:00:00+08:00'), true);
  assert.equal(isModelRecentlyLaunched(image, '2026-12-04T23:59:59+08:00'), true);
  assert.equal(isModelRecentlyLaunched(image, '2026-12-05T00:00:00+08:00'), false);
  assert.equal(isModelRecentlyLaunched(image, 'invalid'), false);
  assert.equal(isModelRecentlyLaunched(modelCatalog[0], '2026-11-05'), false);
});

test('Jev is cataloged as a native System One model and not as chat', () => {
  const jev = modelCatalog.find(({ id }) => id === 'jev-latest');
  assert.ok(jev);
  assert.equal(jev.modality, 'text');
  assert.equal(jev.endpointPath, '/systemone');
  assert.deepEqual(jev.protocols, ['typesafe']);
  assert.equal(jev.apiKeyGroupId, 4);
  assert.equal(jev.input, '$0.042');
  assert.equal(jev.output, '$0.00');
  assert.equal(jev.supportsToolCall, false);
  assert.equal(jev.supportsReasoning, false);
  assert.equal(jev.supportedPlatforms.length, 0);
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

  assert.equal(localized.input, '$2.00–$4.00');
  assert.equal(localized.output, '$6.00–$12.00');
  assert.match(localized.priceUnit, /美元/);
  assert.match(localized.priceUnit, /\$0\.50/);
  assert.doesNotMatch(localized.priceUnit, /参考汇率/);
  assert.equal(grok.input, '$2.00–$4.00');
});

test('formats official USD prices and small price ranges in English', () => {
  const qwen = modelCatalog.find((model) => model.id === 'qwen3.8-max');
  const deepseek = modelCatalog.find((model) => model.id === 'deepseek-flash');
  assert.equal(deepseek.providerModelId, undefined);
  const [qwenEn, deepseekEn] = localizeModels([qwen, deepseek], 'en');

  assert.equal(qwenEn.input, '$1.8462');
  assert.equal(qwenEn.output, '$5.5385');
  assert.match(qwenEn.priceUnit, /USD \/ MTok/);
  assert.match(qwenEn.priceUnit, /\$0.2308/);
  assert.match(qwenEn.priceUnit, /1 USD = 6.5 CNY/);
  assert.equal(deepseekEn.input, '$0.003–$0.006 cached · $0.15–$0.30 uncached');
  assert.equal(deepseekEn.output, '$0.60–$1.20');
  assert.equal(deepseek.input, '$0.003–$0.006 cached · $0.15–$0.30 uncached');
});

test('converts native CNY model prices to USD in Chinese', () => {
  const qwen = modelCatalog.find((model) => model.id === 'qwen3.8-max');
  const localized = localizeModels([qwen], 'zh')[0];

  assert.deepEqual([localized.input, localized.output], ['$1.8462', '$5.5385']);
  assert.match(localized.priceUnit, /美元 \/ 百万 Token/);
  assert.match(localized.priceUnit, /\$0\.2308/);
  assert.match(localized.priceUnit, /参考汇率：1 USD = 6\.5 CNY/);
});

test('quotes both public DeepSeek Flash IDs in USD with localized cache wording', () => {
  const models = modelCatalog.filter(({ id }) => id === 'deepseek-flash' || id === 'deepseek-v4.1-flash-1017');
  const localizedModels = localizeModels(models, 'zh');
  assert.equal(localizedModels.length, 2);
  for (const localized of localizedModels) {
    assert.equal(localized.input, '$0.003–$0.006 缓存 · $0.15–$0.30 未缓存');
    assert.equal(localized.output, '$0.60–$1.20');
    assert.match(localized.priceUnit, /美元/);
    assert.match(localized.priceUnit, /\$0\.003\/\$0\.006/);
    assert.doesNotMatch(localized.priceUnit, /参考汇率/);
  }
});

test('localization keeps unverified prices and unpublished image prices out of monetary conversions', () => {
  const unverified = modelCatalog.find((model) => model.id === 'glm-5.3');
  const image = modelCatalog.find((model) => model.id === 'gpt-image-2.5');
  const [unverifiedEn, imageZh] = localizeModels([unverified, image], 'en');
  const imageChinese = localizeModels([image], 'zh')[0];

  assert.equal(unverifiedEn.input, '待核验');
  assert.equal(unverifiedEn.output, '待核验');
  assert.equal(unverifiedEn.priceUnit, 'Official rate not verified');
  assert.equal(imageZh.showPricing, false);
  assert.equal(imageChinese.showPricing, false);
  assert.equal(imageZh.priceUnit, undefined);
  assert.equal(imageChinese.priceUnit, undefined);
});

test('localizes native currency and time units for media pricing', () => {
  const video = modelCatalog.find((model) => model.id === 'MiniMax-H3');
  const [videoZh, videoEn] = [localizeModels([video], 'zh')[0], localizeModels([video], 'en')[0]];

  assert.equal(videoZh.input, '$0.08 / 秒');
  assert.match(videoZh.priceUnit, /2K 官网价 \$0.13\/秒/);
  assert.equal(videoEn.input, '$0.08 / sec');
  assert.match(videoEn.priceUnit, /2K is \$0.13\/sec/);
});

test('publishes Claude stable models and the PPToken comparison route with official cache rates', () => {
  const expected = {
    'claude-fable-5': [10, 50, 12.5, 20, 1],
    'claude-fable-5-2': [8, 40, 10, 16, 0.2],
    'claude-fable-5-1': [10, 50, 12.5, 20, 0.25],
    'claude-opus-5': [5, 25, 6.25, 10, 0.5],
    'claude-opus-5-5': [4, 20, 5, 8, 0.2],
    'claude-sonnet-5': [2, 10, 2.5, 4, 0.2],
    'claude-sonnet-5-5': [2, 10, 2.5, 4, 0.1],
    'claude-opus-5-5-MAX': [4, 20, 5, 8, 0.2],
  };
  const claudeModels = modelCatalog.filter(({ id }) => id.startsWith('claude-'));
  assert.deepEqual(claudeModels.map(({ id }) => id), Object.keys(expected));
  for (const model of claudeModels) {
    const rates = model.officialPricing;
    assert.deepEqual([rates.input, rates.output, rates.cacheWrite5m, rates.cacheWrite1h, rates.cacheRead], expected[model.id]);
    assert.equal(model.pricingScope, 'sub2api-group');
    assert.equal(model.priceStatus, 'verified');
    assert.equal(model.priceCheckedAt, model.id === 'claude-fable-5-2' ? '2026-11-10' : '2026-10-13');
    assert.equal(model.priceSourceUrl, 'https://platform.claude.com/docs/en/about-claude/pricing');
    assert.equal(model.channelId, 'claude');
    assert.equal(model.modality, 'text');
    assert.equal(model.endpointPath, '/messages');
    assert.equal(model.vendor.en, 'Anthropic');
  }
});

test('Claude models advertise two alternative protocols and resolve to their configured key groups', () => {
  const claude = modelCatalog.filter(({ id }) => id.startsWith('claude-'));
  assert.equal(claude.length, 8);
  for (const model of claude) {
    assert.deepEqual(model.protocols, ['anthropic', 'openai-compatible']);
    if (model.id === 'claude-opus-5-5-MAX') {
      assert.equal(model.apiKeyGroupId, 4);
      assert.equal(getModelApiKeyGroupId(model), 4);
    } else {
      assert.equal(model.apiKeyGroupId, undefined);
      assert.equal(getModelApiKeyGroupId(model), CLAUDE_API_KEY_GROUP_ID);
    }
  }
  const openai = modelCatalog.find(({ id }) => id === 'gpt-6-sol');
  assert.equal(openai.priceMultiplier, 0.6);
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
