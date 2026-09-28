import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPricingPlan, pricingPlans } from './pricing.js';

test('exposes recharge amounts as RMB balance without synthetic point conversions', () => {
  assert.deepEqual(pricingPlans.map(({ id, amount }) => [id, amount]), [
    ['trial', 3],
    ['standard', 15],
    ['regular', 30],
    ['heavy', 90],
    ['team', 150],
  ]);
  assert.equal(defaultPricingPlan.id, 'standard');
  assert.ok(pricingPlans.every((plan) => !Object.hasOwn(plan, 'workbuddyPoints')));
});
