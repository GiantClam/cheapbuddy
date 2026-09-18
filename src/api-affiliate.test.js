import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError, createPaymentOrder, getAffiliateDetail, registerUser, transferAffiliateQuota } from './api.js';

function mockWindow(value = 'fixture') {
  globalThis.window = {
    localStorage: {
      getItem: (key) => key === 'cheapbuddy_auth_token' ? value : null,
    },
  };
}

test('uses authenticated Sub2API affiliate endpoints', async () => {
  mockWindow();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: { aff_code: 'ABCD2345', aff_quota: 6 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await getAffiliateDetail();
    await transferAffiliateQuota();
    assert.deepEqual(calls.map((call) => [call.url, call.options.method, call.options.headers.Authorization]), [
      ['/api/v1/user/aff', undefined, 'Bearer fixture'],
      ['/api/v1/user/aff/transfer', 'POST', 'Bearer fixture'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends a validated affiliate code only when registering from an invite link', async () => {
  mockWindow(null);
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options = {}) => {
    payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: { access_token: 'fixture' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await registerUser('new@example.com', 'secret1', 'turnstile', 'abcd2345');
    assert.equal(payload.aff_code, 'ABCD2345');
    await registerUser('new@example.com', 'secret1', 'turnstile', 'not a valid code');
    assert.equal(payload.aff_code, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preserves pending-order details from a payment API error', async () => {
  mockWindow();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 429,
    message: 'too_many_pending',
    reason: 'TOO_MANY_PENDING',
    metadata: { max: '3' },
  }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await assert.rejects(
      createPaymentOrder({ amount: 30 }),
      (error) => error instanceof ApiRequestError
        && error.status === 429
        && error.reason === 'TOO_MANY_PENDING'
        && error.metadata.max === '3',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
