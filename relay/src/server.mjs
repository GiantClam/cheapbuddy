import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { loadConfig, extractModel, isMediaPath, isTextPath } from './config.mjs';
import { createPool, migrate } from './db.mjs';
import { decryptToken, encryptToken } from './crypto.mjs';
import { IntegrationRepository } from './repository.mjs';
import { fetchWithTimeout, findBill, jsonRequest, provisionShadowUser } from './upstream.mjs';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repository = new IntegrationRepository(pool);

const hopByHopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);

function requestId(request) {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

function sendJson(response, status, value, id) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': id });
  response.end(body);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !config.allowedCorsOrigins.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > config.maxBodyBytes) throw Object.assign(new Error('request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function bearer(request) {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return '';
  return value.slice(7).trim();
}

function headersForUpstream(request, authorization, id, body) {
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    const lower = key.toLowerCase();
    if (hopByHopHeaders.has(lower) || lower === 'authorization' || lower === 'cookie') continue;
    if (Array.isArray(value)) headers[key] = value.join(', ');
    else if (value !== undefined) headers[key] = value;
  }
  headers.authorization = `Bearer ${authorization}`;
  headers['x-request-id'] = id;
  if (typeof request.headers.host === 'string' && request.headers.host.trim()) headers['x-forwarded-host'] = request.headers.host;
  if (typeof request.headers['x-forwarded-proto'] === 'string' && request.headers['x-forwarded-proto'].trim()) {
    headers['x-forwarded-proto'] = request.headers['x-forwarded-proto'];
  } else {
    headers['x-forwarded-proto'] = 'https';
  }
  if (body?.length) headers['content-length'] = String(body.length);
  return headers;
}

function bodyModel(body, contentType) {
  if (!body?.length) return '';
  if (String(contentType).toLowerCase().includes('json')) {
    try { return extractModel(JSON.parse(body.toString('utf8'))); } catch { return ''; }
  }
  const text = body.toString('utf8');
  const match = text.match(/name="model"[^\r\n]*\r?\n\r?\n([^\r\n]+)/i);
  return match?.[1]?.trim() ?? '';
}

function nativeTaskId(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.id === 'string' || typeof payload.id === 'number') return String(payload.id);
  for (const key of ['task_id', 'request_id']) if (payload[key]) return String(payload[key]);
  for (const key of ['data', 'result']) {
    const found = nativeTaskId(payload[key]);
    if (found) return found;
  }
  return '';
}

function mediaSubmission(pathname, method) {
  if (method !== 'POST') return false;
  return pathname.includes('/images/') || pathname === '/v1/videos' || pathname === '/v1/video/generations'
    || pathname.startsWith('/v1/audio/') || pathname.startsWith('/suno/submit/');
}

function isPublicMediaRead(pathname, method) {
  return method === 'GET' && /^\/v1\/media\/[^/]+$/.test(pathname);
}

async function sub2api(request, path, method, body, id, authorization) {
  return fetchWithTimeout(`${config.sub2apiUrl}${path}`, {
    method,
    headers: headersForUpstream(request, authorization, id, body),
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  }, config.sub2apiTimeoutMs);
}

async function resolveIdentity(apiKey, id) {
  return jsonRequest(config.sub2apiUrl, '/api/internal/cheapbuddy/identity', config.relayServiceToken, { api_key: apiKey }, config.sub2apiTimeoutMs, { 'x-request-id': id });
}

async function ensureMapping(identity) {
  const existing = await repository.findUserMapping(identity.user_id);
  if (existing?.newapi_token_ciphertext && existing.newapi_user_id) return existing;
  const provisioned = await provisionShadowUser(config, identity.user_id);
  return repository.saveUserMapping({
    cheapbuddyUserId: identity.user_id,
    sub2apiApiKeyId: identity.api_key_id,
    newapiUserId: provisioned.newapiUserId,
    newapiTokenCiphertext: encryptToken(provisioned.mediaToken, config.tokenEncryptionKey),
  });
}

async function billing(path, payload, id) {
  return jsonRequest(config.sub2apiUrl, `/api/internal/cheapbuddy/billing/${path}`, config.relayServiceToken, payload, config.sub2apiTimeoutMs, { 'x-request-id': id });
}

async function proxy(response, upstreamResponse, id, extraHeaders = {}) {
  const headers = { 'x-request-id': id, ...extraHeaders };
  for (const [key, value] of upstreamResponse.headers) {
    if (!hopByHopHeaders.has(key.toLowerCase()) && !['set-cookie', 'www-authenticate'].includes(key.toLowerCase())) headers[key] = value;
  }
  response.writeHead(upstreamResponse.status, headers);
  response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
}

async function handleMedia(request, response, pathname, url, id, body) {
  if (isPublicMediaRead(pathname, request.method)) {
    try {
      const upstreamResponse = await fetchWithTimeout(`${config.newapiUrl}${pathname}${url.search}`, {
        method: request.method,
        headers: headersForUpstream(request, '', id, body),
      }, config.newapiTimeoutMs);
      return await proxy(response, upstreamResponse, id, corsHeaders(request));
    } catch {
      return sendJson(response, 504, { error: { message: 'NewAPI media request timed out', type: 'upstream_timeout' } }, id);
    }
  }
  const clientKey = bearer(request);
  if (!clientKey) return sendJson(response, 401, { error: { message: 'Missing Bearer API key', type: 'authentication_error' } }, id);
  let identity;
  try {
    identity = await resolveIdentity(clientKey, id);
  } catch {
    return sendJson(response, 401, { error: { message: 'Invalid API key', type: 'authentication_error' } }, id);
  }
  const userId = Number(identity.user_id);
  const apiKeyId = Number(identity.api_key_id);
  if (!Number.isInteger(userId) || !Number.isInteger(apiKeyId) || userId <= 0 || apiKeyId <= 0) return sendJson(response, 503, { error: { message: 'Invalid identity response', type: 'server_error' } }, id);

  let mapping;
  try { mapping = await ensureMapping(identity); } catch (error) {
    console.error(JSON.stringify({ event: 'shadow_provision_failed', request_id: id, user_id: userId, error: error.message }));
    return sendJson(response, 503, { error: { message: 'NewAPI shadow identity unavailable', type: 'server_error' } }, id);
  }
  const token = decryptToken(mapping.newapi_token_ciphertext, config.tokenEncryptionKey);
  const model = bodyModel(body, request.headers['content-type']);
  if (mediaSubmission(pathname, request.method)) {
    if (!model || !config.verifiedModels.includes(model)) return sendJson(response, 400, { error: { message: 'Media model is not verified', type: 'invalid_request_error' } }, id);
    const reservationAmount = config.reservationQuotaByModel[model];
    if (!Number.isInteger(reservationAmount) || reservationAmount < 0) return sendJson(response, 400, { error: { message: 'Media reservation is not configured', type: 'invalid_request_error' } }, id);
    try {
      const reserveResult = await billing('reserve', { request_id: id, api_key_id: apiKeyId, user_id: userId, amount: reservationAmount, payload_hash: '' }, id);
      if (reserveResult?.applied === false) return sendJson(response, 409, { error: { message: 'Request correlation ID is already in use', type: 'conflict' } }, id);
      const inserted = await repository.createMediaRequest({ requestId: id, userId, apiKeyId, reservationId: id, reservationAmount });
      if (!inserted) {
        try {
          await billing('release', { request_id: id, api_key_id: apiKeyId, user_id: userId, amount: reservationAmount, payload_hash: '' }, id);
        } catch (releaseError) {
          console.error(JSON.stringify({ event: 'reservation_release_after_correlation_conflict_failed', request_id: id, error: releaseError.message }));
        }
        return sendJson(response, 409, { error: { message: 'Request correlation ID is already in use', type: 'conflict' } }, id);
      }
    } catch (error) {
      const status = error.message.includes('402') ? 402 : 502;
      return sendJson(response, status, { error: { message: status === 402 ? 'Insufficient balance' : 'Unable to reserve media balance', type: 'billing_error' } }, id);
    }
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetchWithTimeout(`${config.newapiUrl}${pathname}${url.search}`, {
      method: request.method,
      headers: headersForUpstream(request, token, id, body),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
    }, config.newapiTimeoutMs);
  } catch (error) {
    if (mediaSubmission(pathname, request.method)) await repository.markBilling(id, 'pending_reconciliation', { error: 'submission timeout or network error' });
    return sendJson(response, 504, { error: { message: 'NewAPI request timed out', type: 'upstream_timeout' } }, id);
  }
  const responseBytes = Buffer.from(await upstreamResponse.arrayBuffer());
  if (mediaSubmission(pathname, request.method)) {
    if (!upstreamResponse.ok) {
      try {
        const releaseResult = await billing('release', { request_id: id, api_key_id: apiKeyId, user_id: userId, amount: config.reservationQuotaByModel[model], payload_hash: '' }, id);
        await repository.markBilling(id, 'released', { ledgerTransactionId: releaseResult?.billing_request_id, error: `NewAPI rejected request (${upstreamResponse.status})` });
      } catch (error) { await repository.markBilling(id, 'pending_reconciliation', { error: `release failed: ${error.message}` }); }
    } else {
      let payload;
      try { payload = JSON.parse(responseBytes.toString('utf8')); } catch { payload = null; }
      const taskId = nativeTaskId(payload);
      if (taskId) await repository.attachNativeTask(id, taskId);
      else await repository.markBilling(id, 'pending_reconciliation', { error: 'native task id was not present' });
    }
  }
  await proxy(response, new Response(responseBytes, { status: upstreamResponse.status, headers: upstreamResponse.headers }), id, corsHeaders(request));
}

async function reconcile() {
  const pending = await repository.pendingRequests();
  for (const item of pending) {
    if (!item.native_task_id) continue;
    try {
      const result = await fetchWithTimeout(`${config.newapiUrl}${config.newapiLogSearchPath}?keyword=${encodeURIComponent(item.native_task_id)}&p=1&page_size=20`, { headers: { authorization: `Bearer ${config.newapiAdminToken}` } }, config.newapiTimeoutMs);
      const payload = await result.json();
      const bill = result.ok ? findBill(payload, item.native_task_id) : null;
      if (!bill) { await repository.markBilling(item.request_id, 'pending_reconciliation', { error: 'native bill unavailable' }); continue; }
      const captureResult = await billing('capture', { request_id: item.request_id, api_key_id: item.api_key_id, user_id: item.cheapbuddy_user_id, held_amount: Number(item.reservation_amount), actual_amount: bill.finalQuota, payload_hash: '' }, item.request_id);
      await repository.markBilling(item.request_id, 'settled', { ...bill, ledgerTransactionId: captureResult?.billing_request_id });
    } catch (error) {
      await repository.markBilling(item.request_id, 'pending_reconciliation', { error: error.message.slice(0, 300) });
    }
  }
}

const server = http.createServer(async (request, response) => {
  const id = requestId(request);
  try {
    const url = new URL(request.url, 'http://relay.internal');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { ...corsHeaders(request), 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, X-Request-ID' });
      return response.end();
    }
    if (url.pathname === '/healthz') return sendJson(response, 200, { status: 'ok' }, id);
    if (url.pathname === '/readyz') {
      await pool.query('SELECT 1');
      return sendJson(response, 200, { status: 'ready' }, id);
    }
    const media = isMediaPath(url.pathname, config.mediaPaths);
    const text = isTextPath(url.pathname, config.textPaths);
    if (!media && !text) return sendJson(response, 404, { error: { message: 'Route is not allowlisted', type: 'not_found' } }, id);
    const body = request.method === 'GET' || request.method === 'HEAD' ? Buffer.alloc(0) : await readBody(request);
    if (media) return await handleMedia(request, response, url.pathname, url, id, body);
    const authorization = bearer(request);
    if (!authorization) return sendJson(response, 401, { error: { message: 'Missing Bearer API key', type: 'authentication_error' } }, id);
    const upstreamResponse = await sub2api(request, url.pathname + url.search, request.method, body, id, authorization);
    await proxy(response, upstreamResponse, id, corsHeaders(request));
  } catch (error) {
    const status = error.statusCode ?? (error.name === 'AbortError' ? 504 : 500);
    console.error(JSON.stringify({ event: 'relay_error', request_id: id, status, error: error.message }));
    if (!response.headersSent) sendJson(response, status, { error: { message: status === 413 ? 'Request body too large' : 'Relay request failed', type: 'server_error' } }, id);
    else response.destroy();
  }
});

await migrate(pool);
const interval = setInterval(() => { reconcile().catch((error) => console.error(JSON.stringify({ event: 'reconciliation_loop_failed', error: error.message }))); }, config.reconciliationIntervalMs);
interval.unref();
server.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'relay_started', port: config.port })));

async function shutdown() {
  clearInterval(interval);
  server.close(async () => { await pool.end(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
