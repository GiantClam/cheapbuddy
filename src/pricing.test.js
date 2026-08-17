import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN, getBillingState } from './pricing.js';

test('uses the campaign multiplier before the campaign end time', () => {
  const billing = getBillingState(new Date('2026-09-06T17:09:59+08:00'));

  assert.equal(billing.active, true);
  assert.equal(billing.multiplier, 0.2);
});

test('restores the regular multiplier at the campaign end time', () => {
  const billing = getBillingState(new Date(CAMPAIGN.endAt));

  assert.equal(billing.active, false);
  assert.equal(billing.multiplier, 1);
});
