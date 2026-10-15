// Phase-one checks against the existing account and model APIs. No generation
// or payment is submitted. Credentials and complete keys never enter evidence.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ACCOUNT_BASE_URL = 'https://cheapbuddy.cc/api/v1';
export const MODEL_BASE_URL = 'https://api.cheapbuddy.cc/v1';

export function resolveCreationIdempotencyKey(value) {
  if (value === undefined) return `coworkany-${randomUUID()}`;
  if (typeof value !== 'string') throw new Error('invalid_creation_idempotency_key');
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > 128 || [...normalized].some((character) => {
    const code = character.codePointAt(0);
    return code < 33 || code > 126;
  })) throw new Error('invalid_creation_idempotency_key');
  return normalized;
}

export async function checkCoworkany(credentials = {}, { fetchImpl = fetch } = {}) {
  const report = {
    checked_at: new Date().toISOString(),
    account_base_url: ACCOUNT_BASE_URL, model_base_url: MODEL_BASE_URL,
    authenticated_chain_observed: false, checks: [], blockers: [],
    pending: ['session_refresh_and_logout', 'website_purchase', 'paid_model_execution', 'media_task_isolation'],
  };
  const secrets = new Set(Object.values(credentials).filter(value => typeof value === 'string' && value));
  function redact(value, key = '', depth = 0) {
    if (/^(.*token.*|.*secret.*|.*password.*|key|email|.*email.*|username|user_id|ip_.*|last_used_ip|totp_code)$/i.test(key)) return '[REDACTED]';
    if (depth > 8) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.slice(0, 5).map(item => redact(item, '', depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item, name, depth + 1)]));
    if (typeof value !== 'string') return value;
    let safe = value;
    for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]');
    return safe.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, '[REDACTED]');
  }
  async function request(base, endpoint, { token, body, headers = {} } = {}) {
    const method = body ? 'POST' : 'GET';
    const url = `${base}${endpoint}`;
    const check = { method, path: new URL(url).pathname, status: null, outcome: 'failed' };
    report.checks.push(check);
    try {
      const response = await fetchImpl(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      check.status = response.status;
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const payload = await response.json();
      if (payload && typeof payload.code === 'number' && payload.code !== 0) throw new Error('API_ERROR');
      const data = base === ACCOUNT_BASE_URL && Object.hasOwn(payload, 'data') ? payload.data : payload;
      check.sample = redact(payload);
      check.outcome = 'passed';
      return data;
    } catch (error) {
      const reason = /^(HTTP_\d{3}|API_ERROR)$/.test(error.message) ? error.message : 'REQUEST_FAILED';
      check.reason = reason;
      report.blockers.push(`${method} ${check.path}: ${reason}`);
      return undefined;
    }
  }

  await request(ACCOUNT_BASE_URL, '/settings/public');
  let session = credentials.access_token;
  if (!session && credentials.email && credentials.password) {
    let login = await request(ACCOUNT_BASE_URL, '/auth/login', { body: {
      email: credentials.email, password: credentials.password,
      turnstile_token: credentials.turnstile_token,
      tencent_captcha_ticket: credentials.tencent_captcha_ticket,
      tencent_captcha_randstr: credentials.tencent_captcha_randstr,
    } });
    if (login?.temp_token) secrets.add(login.temp_token);
    if (login?.requires_2fa) {
      if (!credentials.totp_code) {
        report.blockers.push('totp_code_required');
        return report;
      }
      login = await request(ACCOUNT_BASE_URL, '/auth/login/2fa', { body: {
        temp_token: login.temp_token, totp_code: credentials.totp_code,
      } });
    }
    session = login?.access_token;
  } else if (session) {
    report.pending.push('login_and_enabled_verification');
  }
  if (!session) {
    report.blockers.push('ordinary_user_credentials_required');
    return report;
  }
  secrets.add(session);
  const user = await request(ACCOUNT_BASE_URL, '/auth/me', { token: session });
  if (!user) return report;
  if (user.role !== 'user') {
    report.blockers.push('ordinary_user_required');
    return report;
  }

  const device = credentials.device_id;
  const deviceName = typeof device === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(device) ? `Coworkany/${device}` : null;
  async function findDeviceKey() {
    for (let page = 1; page <= 20; page += 1) {
      const keys = await request(ACCOUNT_BASE_URL, `/keys?page=${page}&page_size=100`, { token: session });
      if (!keys || !Array.isArray(keys.items)) {
        if (keys) report.blockers.push('invalid_key_list');
        return undefined;
      }
      const key = deviceName && keys.items.find(item => item.name === deviceName && item.status === 'active' &&
        typeof item.key === 'string' && item.key && !item.key.includes('*') &&
        (!item.expires_at || Date.parse(item.expires_at) > Date.now()) &&
        (!item.quota || item.quota_used < item.quota));
      if (key) return key;
      if (typeof keys.total !== 'number') {
        report.blockers.push('invalid_key_pagination');
        return undefined;
      }
      if (page * 100 >= keys.total) return null;
    }
    report.blockers.push('key_lookup_limit_reached');
    return undefined;
  }

  let key = await findDeviceKey();
  if (key === null && !credentials.api_key && credentials.allow_key_creation === true && deviceName) {
    // A confirmed replacement is a new operation, not the old device's cached
    // creation. Keep the returned operation ID when recovering an unknown write.
    let idempotencyKey;
    try {
      idempotencyKey = resolveCreationIdempotencyKey(credentials.creation_idempotency_key);
    } catch {
      report.blockers.push('invalid_creation_idempotency_key');
      idempotencyKey = null;
    }
    report.creation_idempotency_key = idempotencyKey;
    if (idempotencyKey) key = await request(ACCOUNT_BASE_URL, '/keys', {
      token: session, body: { name: deviceName }, headers: { 'Idempotency-Key': idempotencyKey },
    });
    // A timed-out write may have completed. Lookup once; never replay a POST
    // or select an unrelated key merely to make the check pass.
    if (!key) key = await findDeviceKey();
  }
  let modelKey = credentials.api_key;
  if (!modelKey && key?.key) {
    modelKey = key.key;
    if (key.group_id == null) report.blockers.push('default_key_group_unbound');
  }
  let models;
  if (modelKey) {
    secrets.add(modelKey);
    models = await request(MODEL_BASE_URL, '/models', { token: modelKey });
    if (models && !Array.isArray(models.data)) report.blockers.push('invalid_model_catalog');
    if (Array.isArray(models?.data)) {
      const counts = { text: 0, image: 0, video: 0, other: 0 };
      for (const model of models.data) {
        const caps = Array.isArray(model.capabilities) ? model.capabilities : [];
        let classified = false;
        for (const [kind, capabilityNames, typeNames] of [
          ['text', ['text_generation', 'vision'], ['text', 'llm', 'language', 'vision', 'chat']],
          ['image', ['text_to_image', 'image_edit', 'variation'], ['image', 'image_generation']],
          ['video', ['text_to_video', 'image_to_video', 'reference_to_video'], ['video', 'video_generation']],
        ]) {
          if (typeNames.includes(model.type) || caps.some(cap => capabilityNames.includes(cap))) {
            counts[kind] += 1;
            classified = true;
          }
        }
        if (!classified) counts.other += 1;
      }
      report.catalog = counts;
      if (models.data.length === 0) report.blockers.push('empty_model_catalog');
      if (counts.other) report.blockers.push('unclassified_models');
    }
  } else {
    report.blockers.push('device_api_key_required');
  }

  const subscriptions = await request(ACCOUNT_BASE_URL, '/subscriptions/active', { token: session });
  const checkout = await request(ACCOUNT_BASE_URL, '/payment/checkout-info', { token: session });
  const plans = await request(ACCOUNT_BASE_URL, '/payment/plans', { token: session });
  report.authenticated_chain_observed = Array.isArray(models?.data) && Array.isArray(subscriptions) &&
    checkout != null && Array.isArray(plans) && !report.blockers.some(reason =>
      reason.startsWith('GET ') || reason === 'invalid_key_list' || reason === 'invalid_key_pagination');
  // Phase one observes DTOs. It cannot prove that every website recharge tier
  // is a server-side sale item or that a provider will execute a paid task.
  report.pending.push('default_group_policy', 'website_product_catalog_alignment');
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--credentials', '--output'].includes(args[index]) || !args[index + 1]) throw new Error('invalid_arguments');
    values[args[index]] = args[index + 1];
  }
  const credentials = values['--credentials'] ? JSON.parse(await readFile(values['--credentials'], 'utf8')) : {};
  const report = await checkCoworkany(credentials);
  const evidence = `${JSON.stringify(report, null, 2)}\n`;
  if (values['--output']) await writeFile(values['--output'], evidence, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(evidence);
  if (!report.authenticated_chain_observed || report.blockers.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { process.stderr.write('Coworkany check failed; verify arguments, credential file and output path.\n'); process.exitCode = 1; });
}
