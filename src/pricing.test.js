import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_RATE_MULTIPLIER, OFFICIAL_PRICE_MULTIPLIER } from './pricing.js';

test('keeps public pricing disclosure aligned with the production group rate', () => {
  assert.equal(GROUP_RATE_MULTIPLIER, 4);
  assert.equal(OFFICIAL_PRICE_MULTIPLIER, 4);
});
