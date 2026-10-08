import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitialLanguage, setStoredLanguage } from './i18n.js';

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
