import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_CAMPAIGN,
  applyModelCampaign,
  defaultPricingPlan,
  getCheckoutRechargePlans,
  getModelCampaignState,
  getNextModelCampaignBoundaryDelay,
  pricingPlans,
} from './pricing.js';
import * as pricingHelpers from './pricing.js';

test('runs the Claude Opus 5.5 campaign for exactly 15 days', () => {
  assert.equal(
    Date.parse(MODEL_CAMPAIGN.endAt) - Date.parse(MODEL_CAMPAIGN.startAt),
    15 * 24 * 60 * 60 * 1000,
  );
  assert.equal(getModelCampaignState(new Date('2026-10-28T14:59:59+08:00')).active, false);
  assert.equal(getModelCampaignState(new Date(MODEL_CAMPAIGN.startAt)).active, true);
  assert.equal(getModelCampaignState(new Date('2026-11-12T14:59:59+08:00')).active, true);
  assert.equal(getModelCampaignState(new Date(MODEL_CAMPAIGN.endAt)).active, false);
});

test('schedules each campaign boundary without a stale render window', () => {
  assert.equal(getNextModelCampaignBoundaryDelay(new Date('2026-10-28T14:59:59.999+08:00')), 1);
  assert.equal(
    getNextModelCampaignBoundaryDelay(new Date(MODEL_CAMPAIGN.startAt)),
    15 * 24 * 60 * 60 * 1000,
  );
  assert.equal(getNextModelCampaignBoundaryDelay(new Date('2026-11-12T14:59:59.999+08:00')), 1);
  assert.equal(getNextModelCampaignBoundaryDelay(new Date(MODEL_CAMPAIGN.endAt)), null);
  assert.equal(getNextModelCampaignBoundaryDelay(new Date('invalid')), null);
});

test('applies the three-tenths campaign only to Claude Opus 5.5', () => {
  const activeAt = new Date('2026-10-28T15:00:01+08:00');
  const opus = {
    id: 'claude-opus-5-5',
    input: '$4.00',
    output: '$20.00',
    priceUnit: 'USD / MTok; 5m cache write $5.00, 1h cache write $8.00, cache read $0.20',
  };
  const promoted = applyModelCampaign(opus, activeAt);

  assert.equal(promoted.campaignActive, true);
  assert.equal(promoted.campaignMultiplier, 0.3);
  assert.equal(promoted.campaignSavingsPercent, 70);
  assert.equal(promoted.campaignInput, '$1.20');
  assert.equal(promoted.campaignOutput, '$6.00');
  assert.match(promoted.campaignPriceUnit, /5m cache write \$1.50/);
  assert.match(promoted.campaignPriceUnit, /1h cache write \$2.40/);
  assert.match(promoted.campaignPriceUnit, /cache read \$0.06/);
  assert.deepEqual(applyModelCampaign({ ...opus, id: 'claude-opus-5' }, activeAt), { ...opus, id: 'claude-opus-5' });
  assert.deepEqual(applyModelCampaign(opus, new Date(MODEL_CAMPAIGN.endAt)), opus);
  assert.equal(opus.input, '$4.00');
});

test('campaign pricing preserves localized currency displays', () => {
  const promoted = applyModelCampaign({
    id: 'claude-opus-5-5',
    input: '¥26.00',
    output: '¥130.00',
    priceUnit: '人民币 / 百万 Token；缓存读取 ¥1.30',
  }, new Date(MODEL_CAMPAIGN.startAt));

  assert.equal(promoted.campaignInput, '¥7.80');
  assert.equal(promoted.campaignOutput, '¥39.00');
  assert.match(promoted.campaignPriceUnit, /缓存读取 ¥0.39/);
});

test('exposes public CNY payment examples without inventing an authenticated wallet quote', () => {
  assert.deepEqual(pricingPlans.map(({ id, amount }) => [id, amount]), [
    ['trial', 3],
    ['standard', 15],
    ['regular', 30],
    ['heavy', 90],
    ['team', 150],
  ]);
  assert.equal(defaultPricingPlan.id, 'standard');
  assert.ok(pricingPlans.every((plan) => !Object.hasOwn(plan, 'workbuddyPoints')));
  assert.ok(pricingPlans.every((plan) => !Object.hasOwn(plan, 'creditedBalance')));
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

test('equal server USD credits remain equal across CNY and USD payment options', () => {
  const info = {
    ...checkout,
    recharge_tiers: [{ ...checkout.recharge_tiers[0], payment_options: [
      { payment_type: 'stripe', currency: 'USD', amount: 10, pay_amount: 10, credited_balance: 10 },
      { payment_type: 'alipay', currency: 'CNY', amount: 65, pay_amount: 65, credited_balance: 10 },
    ] }],
  };
  assert.equal(getCheckoutRechargePlans(info, 'en')[0].creditedBalance, 10);
  assert.equal(getCheckoutRechargePlans(info, 'zh')[0].creditedBalance, 10);
});

test('token prices use the model multiplier rather than a universal discount', () => {
  const claude = { modality: 'text', priceStatus: 'verified', input: '$2.00', output: '$10.00', priceMultiplier: 1.1,
    priceUnit: 'USD / MTok; cache read $0.10' };
  assert.deepEqual(pricingHelpers.getModelRetailPricing(claude), { input: '$2.20', output: '$11.00', priceUnit: 'USD / MTok; cache read $0.11' });
  assert.equal(pricingHelpers.getModelRetailPricing({ ...claude, priceMultiplier: 0.72 }).input, '$1.44');
  assert.equal(pricingHelpers.getModelRetailPricing({ ...claude, input: '¥0.02–¥0.04 缓存 · ¥1–¥2 未缓存' }).input, '¥0.022–¥0.044 缓存 · ¥1.10–¥2.20 未缓存');
  assert.equal(claude.input, '$2.00');
});

test('retail prices do not invent rates for media, unverified prices or invalid multipliers', () => {
  for (const model of [
    { modality: 'image', priceStatus: 'verified', priceMultiplier: 1.1 },
    { modality: 'text', priceStatus: 'unverified', priceMultiplier: 1.1 },
    { modality: 'text', priceStatus: 'verified' },
    { modality: 'text', priceStatus: 'verified', priceMultiplier: NaN },
    { modality: 'text', priceStatus: 'verified', priceMultiplier: -1 },
  ]) assert.equal(pricingHelpers.getModelRetailPricing(model), null);
  assert.equal(pricingHelpers.getModelRetailPricing({ modality: 'text', priceStatus: 'verified', pricingScope: 'sub2api-group', priceMultiplier: 1.1 }), null);
});
