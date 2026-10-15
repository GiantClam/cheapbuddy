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
