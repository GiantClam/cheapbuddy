import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPaymentAmount, getPaymentCurrency, getPlanPaymentAmount, hasPaymentCurrency, selectPaymentType } from './payment.js';

test('English checkout only selects an available Stripe method', () => {
  assert.equal(selectPaymentType({ easypay: { available: true }, stripe: { available: true } }, 'en'), 'stripe');
  assert.equal(selectPaymentType({ easypay: { available: true } }, 'en'), '');
});

test('Chinese checkout preserves the domestic payment priority', () => {
  assert.equal(selectPaymentType({ stripe: { available: true }, alipay: { available: true } }, 'zh'), 'alipay');
  assert.equal(selectPaymentType({ easypay: { available: true }, alipay: { available: true } }, 'zh'), 'easypay');
});

test('Stripe defaults to USD when the checkout method has no currency', () => {
  assert.equal(getPaymentCurrency('stripe', {}), 'USD');
  assert.equal(getPaymentCurrency('easypay', {}), 'CNY');
  assert.equal(formatPaymentAmount(15, 'USD'), '$15.00');
});

test('English Stripe checkout requires an explicit USD provider currency', () => {
  assert.equal(hasPaymentCurrency({ stripe: { currency: 'USD' } }, 'stripe', 'USD'), true);
  assert.equal(hasPaymentCurrency({ stripe: { currency: 'CNY' } }, 'stripe', 'USD'), false);
  assert.equal(hasPaymentCurrency({ stripe: {} }, 'stripe', 'USD'), false);
});

test('English Stripe plan amounts use the 1 USD to 6.5 CNY rate', () => {
  assert.equal(getPlanPaymentAmount(3, 'en'), 0.46);
  assert.equal(getPlanPaymentAmount(15, 'en'), 2.31);
  assert.equal(getPlanPaymentAmount(90, 'en'), 13.85);
});

test('Chinese plan amounts remain in CNY', () => {
  assert.equal(getPlanPaymentAmount(15, 'zh'), 15);
});
