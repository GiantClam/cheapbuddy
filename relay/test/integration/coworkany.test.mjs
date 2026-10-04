import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCoworkany, resolveCreationIdempotencyKey } from './coworkany.mjs';

function mockAPI(overrides = {}) {
  const calls = [];
  const payloads = {
    '/api/v1/settings/public': { turnstile_enabled: false },
    '/api/v1/auth/login': { access_token: 'session-secret', user: { role: 'user' } },
    '/api/v1/auth/me': { id: 1, email: 'test@example.invalid', role: 'user', balance: 5 },
    '/api/v1/keys': { items: [{ id: 2, name: 'Coworkany/test-device', key: 'model-secret', status: 'active', group_id: 1 }], total: 1 },
    '/api/v1/subscriptions/active': [],
    '/api/v1/payment/checkout-info': { plans: [], methods: {}, balance_disabled: false },
    '/api/v1/payment/plans': [],
    '/v1/models': { object: 'list', data: [
      { id: 'text-model', type: 'vision', capabilities: ['vision'] },
      { id: 'image-model', type: 'image', capabilities: ['text_to_image'] },
      { id: 'video-model', type: 'video', capabilities: ['text_to_video'] },
    ] },
  };
  return { calls, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ url: String(url), path, ...options });
    const override = overrides[path];
    if (typeof override === 'function') return override(options, calls);
    const data = override ?? payloads[path];
    return new Response(JSON.stringify(path === '/v1/models' ? data : { code: 0, data }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  } };
}

const credentials = { email: 'test@example.invalid', password: 'password-secret', device_id: 'test-device' };

test('uses separate user session and model Key; evidence removes credentials', async () => {
  const mock = mockAPI();
  const report = await checkCoworkany(credentials, mock);
  assert.equal(report.authenticated_chain_observed, true);
  const modelCall = mock.calls.find(({ path }) => path === '/v1/models');
  assert.equal(modelCall.headers.Authorization, 'Bearer model-secret');
  assert.equal(mock.calls.find(({ path }) => path === '/api/v1/auth/me').headers.Authorization, 'Bearer session-secret');
  assert.equal(mock.calls.filter(({ method }) => method === 'POST').length, 1);
  assert.deepEqual(report.catalog, { text: 1, image: 1, video: 1, other: 0 });
  const evidence = JSON.stringify(report);
  for (const secret of ['session-secret', 'model-secret', 'password-secret', 'test@example.invalid']) {
    assert.equal(evidence.includes(secret), false, secret);
  }
  assert.ok(report.pending.includes('paid_model_execution'));
});

test('no credentials produces a blocker and performs no writes', async () => {
  const mock = mockAPI();
  const report = await checkCoworkany({}, mock);
  assert.equal(report.authenticated_chain_observed, false);
  assert.ok(report.blockers.includes('ordinary_user_credentials_required'));
  assert.ok(mock.calls.every(({ method }) => method === 'GET'));
});

test('rejects admin sessions before reading keys or creating them', async () => {
  const mock = mockAPI({ '/api/v1/auth/me': { role: 'admin' } });
  const report = await checkCoworkany(credentials, mock);
  assert.ok(report.blockers.includes('ordinary_user_required'));
  assert.equal(mock.calls.some(({ path }) => path === '/api/v1/keys'), false);
});

test('uses the actual 2FA branch without forwarding a temporary token as a session', async () => {
  const mock = mockAPI({
    '/api/v1/auth/login': { requires_2fa: true, temp_token: 'temp-secret' },
    '/api/v1/auth/login/2fa': { access_token: 'session-secret' },
  });
  const report = await checkCoworkany({ ...credentials, totp_code: '123456' }, mock);
  assert.equal(report.authenticated_chain_observed, true);
  const twoFactorCall = mock.calls.find(({ path }) => path.endsWith('/2fa'));
  assert.deepEqual(JSON.parse(twoFactorCall.body), { temp_token: 'temp-secret', totp_code: '123456' });
  assert.equal(JSON.stringify(report).includes('temp-secret'), false);
});

test('never creates a key implicitly, and searches past the first page', async () => {
  const mock = mockAPI({ '/api/v1/keys': (_options, calls) => {
    const page = new URL(calls.at(-1).url).searchParams.get('page');
    return new Response(JSON.stringify({ code: 0, data: {
      items: page === '1' ? [{ name: 'Other/app', key: 'other-secret' }] : [], total: 101,
    } }));
  } });
  const report = await checkCoworkany(credentials, mock);
  assert.equal(mock.calls.filter(({ path }) => path === '/api/v1/keys').length, 2);
  assert.equal(mock.calls.some(({ path, method }) => path === '/api/v1/keys' && method === 'POST'), false);
  assert.ok(report.blockers.includes('device_api_key_required'));
});

test('ambiguous create is recovered by lookup, never resubmitted', async () => {
  let created = false;
  const mock = mockAPI({ '/api/v1/keys': (options) => {
    if (options.method === 'POST') {
      created = true;
      assert.deepEqual(JSON.parse(options.body), { name: 'Coworkany/test-device' });
      assert.ok(options.headers['Idempotency-Key']);
      throw new Error('timeout with password-secret');
    }
    return new Response(JSON.stringify({ code: 0, data: { total: created ? 1 : 0, items: created
      ? [{ name: 'Coworkany/test-device', key: 'model-secret', status: 'active', group_id: null }]
      : [] } }));
  } });
  const report = await checkCoworkany({ ...credentials, allow_key_creation: true }, mock);
  assert.equal(mock.calls.filter(({ path, method }) => path === '/api/v1/keys' && method === 'POST').length, 1);
  assert.ok(report.blockers.includes('default_key_group_unbound'));
  assert.equal(JSON.stringify(report).includes('password-secret'), false);
});

test('creation operation IDs are fresh by default and stable when explicitly supplied', () => {
  const first = resolveCreationIdempotencyKey();
  const second = resolveCreationIdempotencyKey();
  assert.match(first, /^coworkany-[0-9a-f-]{36}$/);
  assert.match(second, /^coworkany-[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
  assert.equal(resolveCreationIdempotencyKey('  operation-123  '), 'operation-123');
});

test('invalid creation operation IDs block the write before POST', async () => {
  const mock = mockAPI({ '/api/v1/keys': () => new Response(JSON.stringify({ code: 0, data: { items: [], total: 0 } })) });
  const report = await checkCoworkany({ ...credentials, allow_key_creation: true, creation_idempotency_key: 'bad key' }, mock);
  assert.ok(report.blockers.includes('invalid_creation_idempotency_key'));
  assert.equal(mock.calls.some(({ path, method }) => path === '/api/v1/keys' && method === 'POST'), false);
  assert.throws(() => resolveCreationIdempotencyKey('x'.repeat(129)), /invalid_creation_idempotency_key/);
  assert.throws(() => resolveCreationIdempotencyKey('中文'), /invalid_creation_idempotency_key/);
});

test('business failures and malformed catalogs never pass as successful observations', async () => {
  const mock = mockAPI({
    '/api/v1/payment/checkout-info': () => new Response(JSON.stringify({ code: 500, message: 'session-secret' })),
    '/v1/models': { object: 'list' },
  });
  const report = await checkCoworkany(credentials, mock);
  assert.equal(report.authenticated_chain_observed, false);
  assert.ok(report.blockers.includes('GET /api/v1/payment/checkout-info: API_ERROR'));
  assert.ok(report.blockers.includes('invalid_model_catalog'));
  assert.equal(JSON.stringify(report).includes('session-secret'), false);
});
