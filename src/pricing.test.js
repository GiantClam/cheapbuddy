import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPricingPlan, pricingPlans, getCheckoutRechargePlans } from './pricing.js';

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

const checkout = {
  methods: { stripe: { currency: 'USD' }, alipay: { currency: 'CNY' } },
  recharge_tiers: [{
    id: 'standard', name: 'Server offer', description: 'Current description', order_type: 'balance', featured: true,
    payment_options: [
      { payment_type: 'stripe', currency: 'USD', amount: 2.5, pay_amount: 2.6, credited_balance: 5 },
      { payment_type: 'alipay', currency: 'CNY', amount: 16, pay_amount: 16.64, credited_balance: 32 },
    ],
  }],
};

test('authenticated recharge uses exact server prices, fees, balance and descriptions', () => {
  const [usd] = getCheckoutRechargePlans(checkout, 'en');
  assert.equal(usd.name, 'Server offer');
  assert.equal(usd.amount, 2.5);
  assert.equal(usd.payAmount, 2.6);
  assert.equal(usd.creditedBalance, 5);
  assert.equal(usd.paymentCurrency, 'USD');
  assert.equal(usd.paymentType, 'stripe');
  const [cny] = getCheckoutRechargePlans(checkout, 'zh');
  assert.equal(cny.amount, 16);
  assert.equal(cny.paymentType, 'alipay');
});

test('missing or empty server catalog never invents purchasable tiers', () => {
  assert.deepEqual(getCheckoutRechargePlans(undefined, 'zh'), []);
  assert.deepEqual(getCheckoutRechargePlans({ methods: checkout.methods }, 'zh'), []);
  assert.deepEqual(getCheckoutRechargePlans({ ...checkout, recharge_tiers: [] }, 'zh'), []);
  assert.deepEqual(getCheckoutRechargePlans({ ...checkout, balance_disabled: true }, 'zh'), []);
});

test('catalog excludes unavailable methods, subscriptions, wrong currencies and invalid amounts', () => {
  const [tier] = checkout.recharge_tiers;
  const variants = [
    { ...checkout, methods: { stripe: { currency: 'USD', available: false } } },
    { ...checkout, methods: { stripe: { currency: 'CNY' } } },
    { ...checkout, recharge_tiers: [{ ...tier, order_type: 'subscription' }] },
    { ...checkout, recharge_tiers: [{ ...tier, payment_options: [{ ...tier.payment_options[0], amount: NaN }] }] },
    { ...checkout, recharge_tiers: [{ ...tier, payment_options: [{ ...tier.payment_options[0], pay_amount: -1 }] }] },
    { ...checkout, recharge_tiers: [{ ...tier, payment_options: [{ ...tier.payment_options[0], credited_balance: Infinity }] }] },
  ];
  for (const info of variants) assert.deepEqual(getCheckoutRechargePlans(info, 'en'), []);
});

test('a tier falls back to another allowed method when preferred method exceeds its limits', () => {
  const info = { ...checkout, methods: { easypay: { currency: 'CNY' }, alipay: { currency: 'CNY' } } };
  const [plan] = getCheckoutRechargePlans(info, 'zh');
  assert.equal(plan.paymentType, 'alipay');
  assert.equal(plan.amount, 16);
});

test('a malformed preferred method does not hide a valid fallback option', () => {
  const info = {
    ...checkout,
    methods: { easypay: { currency: 'CNY' }, alipay: { currency: 'CNY' } },
    recharge_tiers: [{ ...checkout.recharge_tiers[0], payment_options: [
      { payment_type: 'easypay', currency: 'CNY', amount: NaN, pay_amount: 1, credited_balance: 1 },
      { payment_type: 'alipay', currency: 'CNY', amount: 16, pay_amount: 16.64, credited_balance: 32 },
    ] }],
  };
  const [plan] = getCheckoutRechargePlans(info, 'zh');
  assert.equal(plan.paymentType, 'alipay');
  assert.equal(plan.amount, 16);
});
