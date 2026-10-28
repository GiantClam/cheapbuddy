import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitialLanguage, setStoredLanguage, translate } from './i18n.js';

function installBrowserFixture(t, { storedLanguage = 'zh', hasLocale = true } = {}) {
  let stored = storedLanguage;
  const locale = { content: 'zh_CN', setAttribute: (name, value) => { locale[name] = value; } };
  const window = { localStorage: {
    getItem: () => stored,
    setItem: (key, value) => { stored = value; },
  } };
  const document = {
    documentElement: { lang: 'zh-CN' },
    querySelector: (selector) => hasLocale && selector === 'meta[property="og:locale"]' ? locale : null,
  };
  for (const [name, value] of Object.entries({ window, document })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  return { document, locale, window };
}

test('English selection updates HTML and Open Graph language together', (t) => {
  const { document, locale, window } = installBrowserFixture(t);
  setStoredLanguage('en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(locale.content, 'en_US');
  assert.equal(window.localStorage.getItem('cheapbuddy_language'), 'en');
});

test('switching back to Chinese restores the Open Graph locale', (t) => {
  const { document, locale, window } = installBrowserFixture(t);
  setStoredLanguage('en');
  assert.equal(locale.content, 'en_US');
  setStoredLanguage('zh');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(locale.content, 'zh_CN');
  assert.equal(window.localStorage.getItem('cheapbuddy_language'), 'zh');
});

test('reload initialization replaces the HTML default with the stored English locale', (t) => {
  const { document, locale } = installBrowserFixture(t, { storedLanguage: 'en' });
  setStoredLanguage(getInitialLanguage());
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(locale.content, 'en_US');
});

test('language selection remains usable on a page without Open Graph metadata', (t) => {
  const { document } = installBrowserFixture(t, { hasLocale: false });
  assert.doesNotThrow(() => setStoredLanguage('en'));
  assert.equal(document.documentElement.lang, 'en');
});

test('model and generator copy explains shared credentials and alternative protocols in both languages', () => {
  for (const language of ['zh', 'en']) {
    for (const key of ['sharedModelAccess', 'claudeProtocolSupport', 'chooseAccessProtocol', 'protocol_anthropic', 'protocol_openai-compatible', 'officialModelPrice', 'retailModelPrice', 'claudePricePolicy', 'modelAccessRestrictions', 'modelGroupSelectionRequired', 'openCodeCompatibilityNote']) {
      assert.notEqual(translate(language, key), key);
    }
    assert.match(translate(language, 'claudePricePolicy'), /分组|group/i);
    assert.match(translate(language, 'claudeProtocolSupport'), /Anthropic.*OpenAI-compatible/);
    const sharedAccess = translate(language, 'sharedModelAccess');
    assert.match(sharedAccess, /Claude/);
    assert.match(sharedAccess, /OpenAI/);
    assert.match(sharedAccess, /同一把|one CheapBuddy API key/);
    assert.doesNotMatch(sharedAccess, /分别|separate|Claude-group/);
    assert.doesNotMatch(translate(language, 'claudeModelInstruction', { model: 'claude-sonnet-5-5' }), /\{fastModel\}/);
    assert.match(translate(language, 'openCodeCompatibilityNote'), /provider.*npm.*options/);
  }
});

test('Claude Opus 5.5 campaign copy is complete in both languages', () => {
  const expected = {
    zh: {
      campaignTitle: 'Claude Opus 5.5 · 限时 15 天',
      campaignSavingsLabel: '立省',
      campaignSavings: '70%',
      campaignSaleRate: '活动价',
      campaignSaleDiscount: '3 折',
      campaignSalePrices: '输入 {input}/M · 输出 {output}/M',
      campaignRegularRate: '官网价',
      campaignRegularDiscount: '原价',
      campaignRegularPrices: '输入 {input}/M · 输出 {output}/M',
      campaignDuration: '仅 claude-opus-5-5 享受活动价 · 至 {end}（北京时间）',
      campaignModelBadge: '限时 3 折',
      campaignCustomerPrice: '活动价（官网 3 折）',
    },
    en: {
      campaignTitle: 'Claude Opus 5.5 · 15 days only',
      campaignSavingsLabel: 'SAVE',
      campaignSavings: '70%',
      campaignSaleRate: 'Campaign rate',
      campaignSaleDiscount: '30%',
      campaignSalePrices: 'Input {input}/M · output {output}/M',
      campaignRegularRate: 'Official rate',
      campaignRegularDiscount: 'List',
      campaignRegularPrices: 'Input {input}/M · output {output}/M',
      campaignDuration: 'Only claude-opus-5-5 receives this rate · Ends {end} China Standard Time',
      campaignModelBadge: '30% for 15 days',
      campaignCustomerPrice: 'Campaign rate (30% of official)',
    },
  };
  for (const [language, messages] of Object.entries(expected)) {
    for (const [key, value] of Object.entries(messages)) assert.equal(translate(language, key), value);
  }
});
