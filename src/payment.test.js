import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLedgerAmount, formatPaymentAmount, formatPaymentOrderAmount, getPaymentCurrency, getPlanPaymentAmount, getRechargeLedgerAmount, hasPaymentCurrency, selectPaymentType } from './payment.js';

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

test('wallet and usage display dollars explicitly without converting the ledger amount', () => {
  assert.equal(formatLedgerAmount(10), '$10.00 USD');
  assert.equal(formatLedgerAmount(0.0001, 4), '$0.0001 USD');
  assert.equal(formatLedgerAmount(null), '$0.00 USD');
});

test('payment order display follows its recorded currency rather than the payment provider default', () => {
  assert.equal(formatPaymentOrderAmount({ pay_amount: 65, currency: 'CNY', payment_type: 'stripe' }), '¥65.00');
  assert.equal(formatPaymentOrderAmount({ pay_amount: 10, amount: 65, currency: 'USD', payment_type: 'alipay' }), '$10.00');
  assert.equal(formatPaymentOrderAmount({ amount: 2.31, payment_type: 'stripe' }), '$2.31');
});

test('quoted USD credit is never converted again, while unquoted CNY examples are reference conversions', () => {
  assert.equal(getRechargeLedgerAmount({ amount: 65, paymentCurrency: 'CNY', creditedBalance: 10 }), 10);
  assert.equal(getRechargeLedgerAmount({ amount: 10, paymentCurrency: 'USD', creditedBalance: 10 }), 10);
  assert.equal(getRechargeLedgerAmount({ amount: 65 }), 10);
  assert.equal(getRechargeLedgerAmount({ amount: 15 }), 15 / 6.5);
  assert.equal(getRechargeLedgerAmount({ amount: 65, creditedBalance: 0 }), 0);
});
