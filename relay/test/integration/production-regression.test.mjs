import assert from 'node:assert/strict';
import test from 'node:test';
import { checkProduction } from './production-regression.mjs';

const credentials = { email: 'fixture@example.invalid', password: ['fixture', 'value'].join('-') };
const json = (data, status = 200, account = true) => new Response(JSON.stringify(account ? { code: status < 400 ? 0 : status, data } : data), { status });

function mockAPI({ admin = false, ambiguousCreate = false, invalidQuote = false, failModels = false, orderMismatch = false } = {}) {
  const calls = [];
  const existing = { id: 9, name: 'Existing client', key: 'existing-key-private', group_id: 2 };
  let created;
  let logout = false;
  let cancelled = false;
  const models = [
    { id: 'gpt-6.1-sol', type: 'text', capabilities: ['text_generation'] },
    { id: 'image-model', type: 'image', capabilities: ['text_to_image'] },
    { id: 'video-model', type: 'video', capabilities: ['text_to_video'] },
  ];
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body && JSON.parse(options.body);
    calls.push({ path, method: options.method, headers: options.headers, body });
    if (path === '/api/v1/auth/login') return json({ access_token: 'access-private-1', refresh_token: 'refresh-private-1', email: credentials.email });
    if (path === '/api/v1/auth/refresh') {
      if (body.refresh_token === 'refresh-private-1' && !logout && calls.filter(call => call.path === path).length === 1) {
        return json({ access_token: 'access-private-2', refresh_token: 'refresh-private-2' });
      }
      if (body.refresh_token === 'refresh-private-2' && !logout) return json({ access_token: 'unexpected-access', refresh_token: 'unexpected-refresh' });
      return json({ message: 'refresh-private-1' }, 401);
    }
    if (path === '/api/v1/auth/logout') { logout = true; return json({ message: 'Logged out' }); }
    if (path === '/api/v1/auth/me') return json({ role: admin ? 'admin' : 'user', balance: 5, email: credentials.email });
    if (path === '/api/v1/keys' && options.method === 'GET') return json({ items: [existing, ...(created ? [created] : [])], total: created ? 2 : 1 });
    if (path === '/api/v1/keys' && options.method === 'POST') {
      if (created && body.name !== created.name) return json({}, 409);
      if (created) return json(created);
      created = { id: 10, name: body.name, key: 'created-key-private', group_id: 2, status: 'active' };
      if (ambiguousCreate) throw new Error(`network ${credentials.password}`);
      return json(created);
    }
    if (path === '/api/v1/keys/10' && options.method === 'DELETE') { created = null; return json({ message: 'Deleted' }); }
    if (path === '/api/v1/subscriptions/active' || path === '/api/v1/payment/plans') return json([]);
    if (path === '/api/v1/payment/checkout-info') return json({
      plans: [], methods: { alipay: { currency: 'CNY', single_min: 1, single_max: 500 } },
      recharge_tiers: [{ id: 'trial', name: 'Trial', order_type: 'balance', payment_options: [{
        currency: 'CNY', payment_type: 'alipay', amount: 3, pay_amount: invalidQuote ? 0 : 3.03, credited_balance: 6,
      }] }],
      // The runner deliberately never copies unknown response fields.
      credential: 'unrecognized-private', pay_url: 'https://pay.invalid/private-checkout',
    });
    // CreateOrderResponse.currency comes from the provider and is omitempty.
    // The stored order DTO supplies the authoritative currency and quote.
    if (path === '/api/v1/payment/orders' && options.method === 'POST') return json({ order_id: 15, amount: 3, pay_amount: 3.03, status: 'PENDING', pay_url: 'https://pay.invalid/private-checkout', client_secret: 'checkout-secret' });
    if (path === '/api/v1/payment/orders/15/cancel') { cancelled = true; return json({ message: 'Cancelled' }); }
    if (path === '/api/v1/payment/orders/15') return json({ id: 15, amount: 3, pay_amount: orderMismatch ? 3.04 : 3.03, currency: 'CNY', payment_type: 'alipay', order_type: 'balance', status: cancelled ? 'CANCELLED' : 'PENDING' });
    if (path === '/v1/models' && !options.headers.Authorization) return json({}, 401, false);
    if (path === '/v1/models') {
      if (failModels) throw new Error('access-private-2 fixture@example.invalid');
      return json({ object: 'list', data: models }, 200, false);
    }
    if (path === '/v1/models/gpt-6.1-sol') return json(models[0], 200, false);
    if (path === '/v1/usage/dashboard/media') return json({ models: [], summary: { total_requests: 0, total_billed_quota: 0, total_actual_cost: 0 } }, 200, false);
    if (path.startsWith('/v1/videos/')) return json({}, options.headers.Authorization ? 404 : 401, false);
    throw new Error(`Unexpected path ${path}`);
  };
  return { fetchImpl, calls };
}

test('covers production contracts without paid calls and removes only its own Key', async () => {
  const mock = mockAPI();
  const report = await checkProduction(credentials, mock);
  assert.equal(report.passed, true, JSON.stringify(report.failures));
  assert.deepEqual(report.catalog, { text: 1, image: 1, video: 1, other: 0 });
  assert.deepEqual(report.cleanup, { keys_created: 1, keys_deleted: 1, order_cancelled: null, session_logged_out: true });
  assert.deepEqual(mock.calls.filter(call => call.method === 'DELETE').map(call => call.path), ['/api/v1/keys/10']);
  assert.equal(mock.calls.some(call => call.path === '/api/v1/payment/orders'), false);
  assert.equal(mock.calls.some(call => /completions|responses|generations/.test(call.path)), false);
  assert.deepEqual(mock.calls.find(call => call.path === '/api/v1/keys' && call.method === 'POST').body, { name: mock.calls.find(call => call.path === '/api/v1/keys' && call.method === 'POST').body.name });
  assert.equal(mock.calls.find(call => call.path === '/v1/models' && call.headers.Authorization)?.headers.Authorization, 'Bearer created-key-private');
  for (const secret of ['fixture@example.invalid', 'fixture-value', 'access-private-1', 'access-private-2', 'refresh-private-1', 'refresh-private-2', 'existing-key-private', 'created-key-private', 'unrecognized-private', 'https://pay.invalid/private-checkout']) {
    assert.equal(JSON.stringify(report).includes(secret), false, secret);
  }
});

test('recovers an ambiguous Key creation by exact name lookup without another create', async () => {
  const mock = mockAPI({ ambiguousCreate: true });
  const report = await checkProduction(credentials, mock);
  assert.equal(report.passed, true, JSON.stringify(report.failures));
  assert.equal(report.checks.find(check => check.name === 'device_key_create').outcome, 'recovered');
  assert.equal(mock.calls.filter(call => call.path === '/api/v1/keys' && call.method === 'POST').length, 3);
  assert.equal(report.cleanup.keys_deleted, 1);
});

test('admin sessions cannot create Keys or initiate checkout', async () => {
  const mock = mockAPI({ admin: true });
  const report = await checkProduction(credentials, { ...mock, checkout: true });
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('ordinary_user_required'));
  assert.equal(mock.calls.some(call => call.path === '/api/v1/keys' || call.path === '/api/v1/payment/orders'), false);
  assert.equal(report.cleanup.session_logged_out, true);
});

test('invalid quotes and network failures fail acceptance while cleanup still runs', async () => {
  const mock = mockAPI({ invalidQuote: true, failModels: true });
  const report = await checkProduction(credentials, { ...mock, checkout: true });
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('recharge_quote_contract'));
  assert.equal(mock.calls.some(call => call.path === '/api/v1/payment/orders'), false);
  assert.equal(report.cleanup.keys_deleted, 1);
  assert.equal(report.cleanup.session_logged_out, true);
  assert.equal(JSON.stringify(report).includes('access-private-2'), false);
});

test('optional checkout uses the real CNY quote and verifies cancellation', async () => {
  const mock = mockAPI();
  const report = await checkProduction(credentials, { ...mock, checkout: true });
  assert.equal(report.passed, true, JSON.stringify(report.failures));
  const create = mock.calls.find(call => call.path === '/api/v1/payment/orders');
  assert.equal(create.body.amount, 3);
  assert.equal(create.body.payment_type, 'alipay');
  assert.equal(create.body.order_type, 'balance');
  const createIndex = mock.calls.indexOf(create);
  assert.equal(mock.calls[createIndex + 1].path, '/api/v1/payment/orders/15');
  assert.equal(mock.calls[createIndex + 1].method, 'GET');
  assert.deepEqual(report.unpaid_checkout, { currency: 'CNY', amount: 3, pay_amount: 3.03, matches_live_quote: true });
  assert.equal(report.cleanup.order_cancelled, true);
  assert.equal(JSON.stringify(report).includes('checkout-secret'), false);
  assert.equal(JSON.stringify(report).includes('private-checkout'), false);
});

test('stored order quote mismatches fail acceptance and the unpaid order is still cancelled', async () => {
  const mock = mockAPI({ orderMismatch: true });
  const report = await checkProduction(credentials, { ...mock, checkout: true });
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('checkout_matches_live_quote'));
  assert.equal(report.cleanup.order_cancelled, true);
});

test('transient GET network failures retry once while write failures never automatically retry', async () => {
  const mock = mockAPI();
  let planCalls = 0;
  let createCalls = 0;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/payment/plans' && ++planCalls === 1) throw new Error('temporary network with fixture-value');
    if (path === '/api/v1/payment/orders' && options.method === 'POST') {
      createCalls += 1;
      throw new Error('unknown write outcome private-password');
    }
    return mock.fetchImpl(url, options);
  };
  const report = await checkProduction(credentials, { fetchImpl, checkout: true });
  const plans = report.checks.find(check => check.name === 'sale_plans');
  assert.equal(plans.outcome, 'passed');
  assert.equal(plans.attempts, 2);
  assert.equal(createCalls, 1);
  assert.ok(report.failures.includes('unpaid_order_creation_unknown_no_retry'));
  assert.equal(JSON.stringify(report).includes('fixture-value'), false);
});

test('GET retries stay bounded and malformed JSON is a contract failure without retry', async () => {
  const mock = mockAPI();
  let planCalls = 0;
  let subscriptionCalls = 0;
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/v1/payment/plans') { planCalls += 1; throw new Error('network'); }
    if (path === '/api/v1/subscriptions/active') { subscriptionCalls += 1; return new Response('invalid json'); }
    return mock.fetchImpl(url, options);
  };
  const report = await checkProduction(credentials, { fetchImpl });
  assert.equal(report.passed, false);
  assert.equal(planCalls, 2);
  assert.equal(subscriptionCalls, 1);
  assert.ok(report.failures.includes('sale_plans'));
  assert.ok(report.failures.includes('active_subscriptions'));
  assert.equal(report.cleanup.keys_deleted, 1);
});

test('unknown cancellation outcomes are checked by GET and never blindly resubmitted', async () => {
  for (const actuallyCancelled of [true, false]) {
    const mock = mockAPI();
    let cancelCalls = 0;
    const fetchImpl = async (url, options) => {
      if (new URL(url).pathname === '/api/v1/payment/orders/15/cancel') {
        cancelCalls += 1;
        if (actuallyCancelled) await mock.fetchImpl(url, options);
        throw new Error('unknown cancellation with fixture-value');
      }
      return mock.fetchImpl(url, options);
    };
    const report = await checkProduction(credentials, { fetchImpl, checkout: true });
    assert.equal(cancelCalls, 1);
    assert.equal(report.cleanup.order_cancelled, actuallyCancelled);
    assert.equal(report.passed, actuallyCancelled, JSON.stringify(report.failures));
    assert.equal(report.cleanup.keys_deleted, 1);
  }
});

test('missing credentials cause no requests or writes', async () => {
  const mock = mockAPI();
  const report = await checkProduction({}, mock);
  assert.equal(report.passed, false);
  assert.equal(mock.calls.length, 0);
});

test('existing ordinary session pairs are accepted with password login explicitly untested', async () => {
  const mock = mockAPI();
  const report = await checkProduction({ access_token: 'access-private-1', refresh_token: 'refresh-private-1' }, mock);
  assert.equal(report.passed, true, JSON.stringify(report.failures));
  assert.equal(mock.calls.some(call => call.path === '/api/v1/auth/login'), false);
  assert.ok(report.not_executed.includes('password_login_existing_session_used'));
  assert.equal(report.cleanup.session_logged_out, true);
});

test('a logout response cannot pass if the logged-out refresh still works', async () => {
  const mock = mockAPI();
  const fetchImpl = async (url, options) => new URL(url).pathname === '/api/v1/auth/logout'
    ? json({ message: 'pretend logout' }) : mock.fetchImpl(url, options);
  const report = await checkProduction(credentials, { fetchImpl });
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('logout_refresh_revoked'));
  assert.equal(report.cleanup.keys_deleted, 1);
  assert.equal(report.cleanup.session_logged_out, false);
  assert.equal(JSON.stringify(report).includes('unexpected-refresh'), false);
});
