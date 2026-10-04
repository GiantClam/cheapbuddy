// Production account/catalog regression. Never submits generation or payment.
// Credentials stay in memory; evidence contains only explicitly selected fields.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACCOUNT_BASE_URL, MODEL_BASE_URL } from './coworkany.mjs';

const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const usableID = value => Number.isSafeInteger(value) && value > 0;
const inside = (value, min, max) => (!positive(min) || value + 1e-8 >= min) && (!positive(max) || value <= max + 1e-8);
const safePath = url => new URL(url).pathname
  .replace(/\/keys\/\d+$/, '/keys/{test_key_id}')
  .replace(/\/orders\/\d+(\/cancel)?$/, '/orders/{test_order_id}$1')
  .replace(/\/videos\/[^/]+/, '/videos/{unknown_task_id}');

function classifyModels(models) {
  const counts = { text: 0, image: 0, video: 0, other: 0 };
  for (const model of models) {
    const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
    let classified = false;
    for (const [kind, caps, types] of [
      ['text', ['text_generation', 'vision'], ['text', 'llm', 'language', 'vision', 'chat']],
      ['image', ['text_to_image', 'image_edit', 'variation'], ['image', 'image_generation']],
      ['video', ['text_to_video', 'image_to_video', 'reference_to_video'], ['video', 'video_generation']],
    ]) {
      if (types.includes(model.type) || capabilities.some(capability => caps.includes(capability))) {
        counts[kind] += 1;
        classified = true;
      }
    }
    if (!classified) counts.other += 1;
  }
  return counts;
}

function validRechargeQuotes(checkout) {
  if (!Array.isArray(checkout?.recharge_tiers) || !checkout.recharge_tiers.length ||
      !checkout.methods || typeof checkout.methods !== 'object' || checkout.balance_disabled === true) return false;
  const ids = new Set();
  return checkout.recharge_tiers.every(tier => {
    if (typeof tier.id !== 'string' || !tier.id || ids.has(tier.id) || tier.order_type !== 'balance' ||
        !Array.isArray(tier.payment_options) || !tier.payment_options.length) return false;
    ids.add(tier.id);
    return tier.payment_options.every(option => {
      const method = checkout.methods[option.payment_type];
      return method && typeof option.currency === 'string' && /^[A-Z]{3}$/.test(option.currency) &&
        method.currency?.trim().toUpperCase() === option.currency &&
        [option.amount, option.pay_amount, option.credited_balance].every(positive) &&
        inside(option.pay_amount, method.single_min, method.single_max) &&
        (!['CNY', 'USD'].includes(option.currency) ||
          [option.amount, option.pay_amount].every(amount => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6));
    });
  });
}

export async function checkProduction(credentials = {}, { fetchImpl = fetch, checkout = false } = {}) {
  const report = {
    checked_at: new Date().toISOString(), passed: false,
    account_base_url: ACCOUNT_BASE_URL, model_base_url: MODEL_BASE_URL,
    scope: 'account_catalog_and_unpaid_checkout', checks: [], failures: [],
    cleanup: { keys_created: 0, keys_deleted: 0, order_cancelled: null, session_logged_out: false },
    not_executed: ['paid_text_generation', 'paid_image_generation', 'paid_video_generation',
      'payment_settlement', 'cross_user_task_isolation', 'hypit_host_runtime', 'comfyui_gui_workflow'],
  };
  if (!checkout) report.not_executed.push('unpaid_checkout_creation');
  const fail = name => { if (!report.failures.includes(name)) report.failures.push(name); };
  const assert = (condition, name) => { if (!condition) fail(name); return Boolean(condition); };
  let session = credentials.access_token;
  let refreshToken = credentials.refresh_token;
  let ordinaryUser = false;
  let canOwnNames = false;
  let orderID;
  let cancellationAttempted = false;
  const refreshTokens = new Set();
  const ownKeys = new Map();
  const deviceName = `Coworkany/regression-${randomUUID()}`;
  const conflictName = `${deviceName}-conflict`;
  const ownNames = new Set([deviceName, conflictName]);
  const idempotencyKey = `regression-${randomUUID()}`;

  function rememberSession(data) {
    if (typeof data?.refresh_token === 'string' && data.refresh_token) refreshTokens.add(data.refresh_token);
  }
  async function request(name, base, endpoint, { token, method = 'GET', body, headers = {}, expected = 200 } = {}) {
    const url = `${base}${endpoint}`;
    const check = { name, method, path: safePath(url), expected_status: expected, status: null, outcome: 'failed', attempts: 0 };
    report.checks.push(check);
    const maxAttempts = method === 'GET' ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      check.attempts = attempt;
      let response;
      try {
        response = await fetchImpl(url, {
          method, redirect: 'error', signal: AbortSignal.timeout(20_000),
          headers: { Accept: 'application/json', 'User-Agent': 'CheapBuddy-Regression/1.0',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        if (attempt < maxAttempts) { check.retry_reason = 'network_error'; continue; }
        check.reason = 'request_or_json_failed';
        return { check };
      }
      check.status = response.status;
      try {
        const payload = await response.json();
        if (base === ACCOUNT_BASE_URL) rememberSession(payload?.data);
        if (response.status !== expected) check.reason = 'unexpected_http_status';
        else if (expected < 400 && base === ACCOUNT_BASE_URL && payload?.code !== 0) check.reason = 'api_error';
        else check.outcome = 'passed';
        return { check, data: base === ACCOUNT_BASE_URL ? payload?.data : payload };
      } catch {
        // A malformed response is a contract failure, not a transient network retry.
        check.reason = 'request_or_json_failed';
        return { check };
      }
    }
    return { check };
  }
  function required(result, name = result.check.name) {
    return assert(['passed', 'recovered'].includes(result.check.outcome), name);
  }
  function registerKey(key) {
    if (canOwnNames && usableID(key?.id) && ownNames.has(key.name)) ownKeys.set(key.id, key.name);
    report.cleanup.keys_created = ownKeys.size;
  }
  async function findOwnKeys(name) {
    const found = [];
    for (let page = 1; page <= 20; page += 1) {
      const result = await request(name, ACCOUNT_BASE_URL,
        `/keys?page=${page}&page_size=100&search=${encodeURIComponent(deviceName)}`, { token: session });
      if (!required(result) || !assert(Array.isArray(result.data?.items) &&
          Number.isSafeInteger(result.data.total) && result.data.total >= 0, 'key_list_contract')) return undefined;
      found.push(...result.data.items.filter(key => ownNames.has(key.name)));
      if (page * 100 >= result.data.total) return found;
    }
    fail('key_lookup_limit_reached');
    return undefined;
  }
  async function checkDeviceKey() {
    const previous = await findOwnKeys('device_name_preflight');
    if (!previous || !assert(previous.length === 0, 'device_name_already_exists')) return undefined;
    canOwnNames = true;
    const options = { token: session, method: 'POST', body: { name: deviceName }, headers: { 'Idempotency-Key': idempotencyKey } };
    const creation = await request('device_key_create', ACCOUNT_BASE_URL, '/keys', options);
    registerKey(creation.data);
    const recovered = await findOwnKeys('device_name_recovery');
    recovered?.forEach(registerKey);
    const matches = recovered?.filter(key => key.name === deviceName);
    const key = matches?.length === 1 ? matches[0] : undefined;
    if (key && creation.check.reason === 'request_or_json_failed') {
      creation.check.outcome = 'recovered';
      creation.check.reason = 'exact_name_lookup_confirmed';
    } else required(creation);
    if (!assert(key && usableID(key.id) && typeof key.key === 'string' && key.key && !key.key.includes('*') &&
        key.status === 'active' && key.group_id === 2, 'default_device_key_group2')) return undefined;
    if (creation.data) assert(creation.data.id === key.id && creation.data.name === deviceName, 'created_key_matches_lookup');
    const replay = await request('device_key_idempotent_replay', ACCOUNT_BASE_URL, '/keys', options);
    registerKey(replay.data);
    if (required(replay)) assert(replay.data?.id === key.id && replay.data?.key === key.key, 'idempotent_same_key');
    const conflict = await request('device_key_body_conflict', ACCOUNT_BASE_URL, '/keys', {
      ...options, body: { name: conflictName }, expected: 409,
    });
    registerKey(conflict.data);
    required(conflict);
    return key.key;
  }
  async function checkModels(key) {
    required(await request('anonymous_models_denied', MODEL_BASE_URL, '/models', { expected: 401 }));
    const models = await request('authenticated_models', MODEL_BASE_URL, '/models', { token: key });
    if (required(models) && assert(Array.isArray(models.data?.data), 'model_catalog_contract')) {
      report.catalog = classifyModels(models.data.data);
      assert(['text', 'image', 'video'].every(kind => report.catalog[kind] > 0) && report.catalog.other === 0, 'catalog_classification');
      assert(models.data.data.some(model => model.id === 'gpt-6.1-sol'), 'gpt61_in_user_catalog');
    }
    const detail = await request('gpt61_model_detail', MODEL_BASE_URL, '/models/gpt-6.1-sol', { token: key });
    if (required(detail)) assert(detail.data?.id === 'gpt-6.1-sol', 'gpt61_detail_contract');
    const unknownTask = `cb-regression-unknown-${randomUUID()}`;
    for (const suffix of ['', '/content']) {
      required(await request(suffix ? 'anonymous_content_denied' : 'anonymous_task_denied', MODEL_BASE_URL,
        `/videos/${unknownTask}${suffix}`, { expected: 401 }));
      required(await request(suffix ? 'unknown_content_hidden' : 'unknown_task_hidden', MODEL_BASE_URL,
        `/videos/${unknownTask}${suffix}`, { token: key, expected: 404 }));
    }
    const usage = await request('media_usage', MODEL_BASE_URL, '/usage/dashboard/media', { token: key });
    if (required(usage)) assert(Array.isArray(usage.data?.models) &&
      ['total_requests', 'total_billed_quota', 'total_actual_cost'].every(field =>
        typeof usage.data.summary?.[field] === 'number' && Number.isFinite(usage.data.summary[field]) && usage.data.summary[field] >= 0), 'media_usage_contract');
  }
  async function cancelOrder() {
    if (!usableID(orderID) || cancellationAttempted) return;
    cancellationAttempted = true;
    const cancelled = await request('unpaid_order_cancel', ACCOUNT_BASE_URL, `/payment/orders/${orderID}/cancel`, { token: session, method: 'POST', body: {} });
    const state = await request('cancelled_order_state', ACCOUNT_BASE_URL, `/payment/orders/${orderID}`, { token: session });
    const confirmedCancelled = state.check.outcome === 'passed' && state.data?.status === 'CANCELLED';
    if (cancelled.check.reason === 'request_or_json_failed' && confirmedCancelled) {
      cancelled.check.outcome = 'recovered';
      cancelled.check.reason = 'stored_order_cancellation_confirmed';
    }
    report.cleanup.order_cancelled = ['passed', 'recovered'].includes(cancelled.check.outcome) && confirmedCancelled;
    required(cancelled);
    required(state);
    assert(report.cleanup.order_cancelled, 'unpaid_order_cancelled');
  }
  async function checkCheckout(info) {
    const valid = assert(validRechargeQuotes(info), 'recharge_quote_contract');
    if (valid) report.recharge_catalog = {
      tiers: info.recharge_tiers.length,
      options: info.recharge_tiers.reduce((sum, tier) => sum + tier.payment_options.length, 0),
      currencies: [...new Set(info.recharge_tiers.flatMap(tier => tier.payment_options.map(option => option.currency)))].sort(),
    };
    if (!checkout || !valid) return;
    const option = info.recharge_tiers.flatMap(tier => tier.payment_options)
      .filter(candidate => candidate.currency === 'CNY').sort((a, b) => a.amount - b.amount)[0];
    if (!assert(option, 'cny_checkout_option_required')) return;
    const result = await request('unpaid_order_create', ACCOUNT_BASE_URL, '/payment/orders', {
      token: session, method: 'POST', body: { amount: option.amount, payment_type: option.payment_type,
        order_type: 'balance', is_mobile: false },
    });
    // Capture the ID even when response validation fails so finally can cancel it.
    orderID = result.data?.order_id;
    if (result.check.status === null) fail('unpaid_order_creation_unknown_no_retry');
    if (required(result) && assert(usableID(orderID), 'unpaid_order_id_contract')) {
      // CreateOrderResponse.currency is provider metadata and may be omitted.
      // GetOrder's stored-order DTO is authoritative for billing and currency.
      const stored = await request('created_order_quote', ACCOUNT_BASE_URL, `/payment/orders/${orderID}`, { token: session });
      if (required(stored)) {
        const order = stored.data;
        const matches = assert(order?.id === orderID && order.status === 'PENDING' &&
          order.order_type === 'balance' && order.payment_type === option.payment_type &&
          order.currency === option.currency && positive(order.amount) && positive(order.pay_amount) &&
          Math.abs(order.amount - option.amount) < 1e-8 && Math.abs(order.pay_amount - option.pay_amount) < 1e-8,
        'checkout_matches_live_quote');
        if (matches) report.unpaid_checkout = {
          currency: 'CNY', amount: order.amount, pay_amount: order.pay_amount, matches_live_quote: true,
        };
      }
    }
    await cancelOrder();
  }
  async function cleanup() {
    if (usableID(orderID) && report.cleanup.order_cancelled !== true) await cancelOrder();
    if (ordinaryUser && canOwnNames) {
      const remaining = await findOwnKeys('cleanup_device_lookup');
      remaining?.forEach(registerKey);
      for (const id of ownKeys.keys()) {
        const result = await request('cleanup_device_key', ACCOUNT_BASE_URL, `/keys/${id}`, { token: session, method: 'DELETE' });
        if (required(result)) report.cleanup.keys_deleted += 1;
      }
      const after = await findOwnKeys('cleanup_device_absent');
      assert(after?.length === 0 && report.cleanup.keys_deleted === ownKeys.size, 'test_key_cleanup_complete');
    }
    if (refreshToken) {
      const result = await request('session_logout', ACCOUNT_BASE_URL, '/auth/logout', { method: 'POST', body: { refresh_token: refreshToken } });
      const logoutAccepted = required(result);
      const revoked = await request('logout_refresh_revoked', ACCOUNT_BASE_URL, '/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken }, expected: 401 });
      report.cleanup.session_logged_out = required(revoked) && logoutAccepted;
      refreshTokens.delete(refreshToken);
    }
    for (const token of refreshTokens) required(await request('cleanup_other_refresh', ACCOUNT_BASE_URL, '/auth/logout', { method: 'POST', body: { refresh_token: token } }));
  }

  try {
    if (!session && credentials.email && credentials.password) {
      const login = await request('ordinary_login', ACCOUNT_BASE_URL, '/auth/login', {
        method: 'POST', body: { email: credentials.email, password: credentials.password,
          turnstile_token: credentials.turnstile_token, tencent_captcha_ticket: credentials.tencent_captcha_ticket,
          tencent_captcha_randstr: credentials.tencent_captcha_randstr },
      });
      if (!required(login)) return report;
      if (!assert(!login.data?.requires_2fa, 'two_factor_flow_requires_separate_validation')) return report;
      session = login.data?.access_token;
      refreshToken = login.data?.refresh_token;
    } else if (session) {
      rememberSession(credentials);
      report.not_executed.push('password_login_existing_session_used');
    }
    if (!assert(typeof session === 'string' && session && typeof refreshToken === 'string' && refreshToken, 'credentials_or_session_pair_required')) return report;
    const user = await request('ordinary_user_me', ACCOUNT_BASE_URL, '/auth/me', { token: session });
    if (!required(user) || !assert(user.data?.role === 'user', 'ordinary_user_required')) return report;
    ordinaryUser = true;
    const oldRefresh = refreshToken;
    const rotation = await request('refresh_rotation', ACCOUNT_BASE_URL, '/auth/refresh', { method: 'POST', body: { refresh_token: oldRefresh } });
    if (!required(rotation) || !assert(typeof rotation.data?.access_token === 'string' && rotation.data.access_token &&
        typeof rotation.data.refresh_token === 'string' && rotation.data.refresh_token &&
        rotation.data.refresh_token !== oldRefresh, 'refresh_pair_rotated')) return report;
    session = rotation.data.access_token;
    refreshToken = rotation.data.refresh_token;
    required(await request('old_refresh_revoked', ACCOUNT_BASE_URL, '/auth/refresh', { method: 'POST', body: { refresh_token: oldRefresh }, expected: 401 }));
    const refreshedMe = await request('refreshed_user_me', ACCOUNT_BASE_URL, '/auth/me', { token: session });
    if (required(refreshedMe)) assert(refreshedMe.data?.role === 'user', 'refreshed_user_contract');
    const key = await checkDeviceKey();
    if (key) await checkModels(key);
    const subscriptions = await request('active_subscriptions', ACCOUNT_BASE_URL, '/subscriptions/active', { token: session });
    if (required(subscriptions)) assert(Array.isArray(subscriptions.data), 'active_subscriptions_contract');
    const plans = await request('sale_plans', ACCOUNT_BASE_URL, '/payment/plans', { token: session });
    if (required(plans)) assert(Array.isArray(plans.data), 'sale_plans_contract');
    const info = await request('checkout_info', ACCOUNT_BASE_URL, '/payment/checkout-info', { token: session });
    if (required(info)) {
      assert(Array.isArray(info.data?.plans), 'checkout_plan_contract');
      await checkCheckout(info.data);
    }
  } catch {
    fail('runner_failed_without_sensitive_error_details');
  } finally {
    try { await cleanup(); } catch { fail('cleanup_failed'); }
    report.passed = report.failures.length === 0 && ordinaryUser;
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) throw new Error('invalid_arguments');
  const report = await checkProduction({
    email: process.env.CHEAPBUDDY_TEST_EMAIL, password: process.env.CHEAPBUDDY_TEST_PASSWORD,
    access_token: process.env.CHEAPBUDDY_TEST_ACCESS_TOKEN, refresh_token: process.env.CHEAPBUDDY_TEST_REFRESH_TOKEN,
    turnstile_token: process.env.CHEAPBUDDY_TEST_TURNSTILE_TOKEN,
    tencent_captcha_ticket: process.env.CHEAPBUDDY_TEST_CAPTCHA_TICKET,
    tencent_captcha_randstr: process.env.CHEAPBUDDY_TEST_CAPTCHA_RANDSTR,
  }, { checkout: process.env.CHEAPBUDDY_TEST_CHECKOUT === '1' });
  const evidence = `${JSON.stringify(report, null, 2)}\n`;
  if (args[1]) await writeFile(args[1], evidence, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(evidence);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('Production regression failed; check environment credentials and output arguments.\n'); process.exitCode = 1; });
}
