import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRechargeGuidance,
  isUserBalanceInsufficientResponse,
} from './balance-recharge.mjs';

test('adds a CheapBuddy recharge link to the native user balance error', () => {
  const original = { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient account balance' };
  assert.equal(isUserBalanceInsufficientResponse(original, 403), true);
  assert.deepEqual(addRechargeGuidance(original), {
    code: 'INSUFFICIENT_BALANCE',
    message: 'CheapBuddy balance is insufficient / CheapBuddy 账户余额不足，请充值后重试. Recharge your CheapBuddy balance and retry: https://cheapbuddy.cc/#pricing',
    recharge_url: 'https://cheapbuddy.cc/#pricing',
  });
});

test('adds recharge guidance to OpenAI and Anthropic-shaped user balance errors', () => {
  const openAI = addRechargeGuidance({
    error: { code: 'INSUFFICIENT_BALANCE', type: 'billing_error', message: 'Insufficient account balance' },
  });
  const anthropic = addRechargeGuidance({
    type: 'error',
    error: { code: 'INSUFFICIENT_BALANCE', type: 'permission_error', message: 'Insufficient account balance' },
  });

  assert.match(openAI.error.message, /https:\/\/cheapbuddy\.cc\/#pricing/);
  assert.equal(openAI.error.recharge_url, 'https://cheapbuddy.cc/#pricing');
  assert.match(anthropic.error.message, /Recharge your CheapBuddy balance/);
});

test('recognizes the Google-shaped 403 balance error used by desktop clients', () => {
  const original = {
    error: { code: 403, status: 'PERMISSION_DENIED', message: 'Insufficient account balance' },
  };

  assert.equal(isUserBalanceInsufficientResponse(original, 403), true);
  const enriched = addRechargeGuidance(original);
  assert.match(enriched.error.message, /余额不足/);
  assert.equal(enriched.error.recharge_url, 'https://cheapbuddy.cc/#pricing');
});

test('recognizes an explicit Chinese balance error without weakening auth errors', () => {
  assert.equal(isUserBalanceInsufficientResponse({ error: { message: '余额不足' } }, 403), true);
  assert.equal(isUserBalanceInsufficientResponse({ error: { message: '鉴权失败' } }, 403), false);
  assert.equal(isUserBalanceInsufficientResponse({ error: { message: '模型权限不足' } }, 403), false);
});

test('adds guidance to the relay 402 reservation error', () => {
  const enriched = addRechargeGuidance({ message: 'Insufficient balance or reservation unavailable' }, 402);
  assert.match(enriched.message, /账户余额不足|Recharge/);
  assert.equal(enriched.recharge_url, 'https://cheapbuddy.cc/#pricing');
});

test('does not rewrite upstream quota, authentication, or unrelated server errors', () => {
  assert.equal(isUserBalanceInsufficientResponse({ code: 'INVALID_API_KEY', message: 'Invalid API key' }, 401), false);
  assert.equal(isUserBalanceInsufficientResponse({ error: { code: 'insufficient_quota', message: 'Upstream quota exceeded' } }, 429), false);
  assert.deepEqual(addRechargeGuidance({ error: { message: 'Upstream quota exceeded' } }), { error: { message: 'Upstream quota exceeded' } });
});
