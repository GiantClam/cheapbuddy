import test from 'node:test';
import assert from 'node:assert/strict';
import { translate } from './i18n.js';

test('both languages distinguish USD wallet credit from payment currencies', () => {
  for (const language of ['zh', 'en']) {
    assert.match(translate(language, 'currentBalance'), /USD/);
    assert.match(translate(language, 'pricingPlanNote'), /USD/);
    assert.match(translate(language, 'sharedBalance'), /USD/);
    assert.match(translate(language, 'affiliateFrozenBalance', { amount: '$10.00 USD' }), /\$10\.00 USD/);
    assert.doesNotMatch(translate(language, 'affiliateFrozenBalance', { amount: '$10.00 USD' }), /¥/);
    assert.doesNotMatch(translate(language, 'affiliateTransferSuccess', { amount: '$10.00 USD' }), /¥/);
    for (const key of ['registerIntro', 'registerTrial', 'authFootnote']) {
      assert.doesNotMatch(translate(language, key), /[¥$]\s*1\b/);
    }
  }
});

test('OpenCode comparison interpolates the estimated usage range in both languages', () => {
  for (const language of ['zh', 'en']) {
    const copy = translate(language, 'pricingComparisonOpenCode', {
      amount: '¥15',
      cny: '¥15',
      usd: '$2.31',
      low: '3.47',
      high: '13.86',
    });
    assert.match(copy, /3\.47/);
    assert.match(copy, /13\.86/);
    assert.doesNotMatch(copy, /\{percent\}/);
  }
});
