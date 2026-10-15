import { randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';

async function resolveRailwayPrivateUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.hostname.endsWith('.railway.internal')) return rawUrl;

  const { address } = await dns.lookup(url.hostname, { family: 4 });
  url.hostname = address;
  return url.toString();
}

export async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const targetUrl = await resolveRailwayPrivateUrl(url);
    return await fetch(targetUrl, { ...options, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

export async function jsonRequest(baseUrl, path, token, body, timeoutMs, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`upstream ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

function responseData(data) {
  return data?.data ?? data?.result ?? data;
}

export async function provisionShadowUser(config, userId) {
  const username = `cheapbuddy_${userId}`;
  const password = randomBytes(12).toString('base64url');
  let created = await jsonRequest(config.newapiUrl, config.newapiUserPath, config.newapiAdminToken, {
    username,
    password,
    display_name: username,
    role: 1,
    quota: 0,
  }, config.newapiTimeoutMs);
  let newapiUserId = Number(responseData(created)?.id ?? responseData(created)?.user?.id);
  if (!Number.isInteger(newapiUserId) || newapiUserId <= 0) {
    const search = await fetchWithTimeout(`${config.newapiUrl}/api/user/search?keyword=${encodeURIComponent(username)}&p=1&page_size=10`, {
      headers: { authorization: `Bearer ${config.newapiAdminToken}` },
    }, config.newapiTimeoutMs);
    const searched = await search.json();
    const rows = responseData(searched)?.items ?? responseData(searched) ?? [];
    const found = Array.isArray(rows) ? rows.find((item) => item.username === username) : null;
    newapiUserId = Number(found?.id);
  }
  if (!Number.isInteger(newapiUserId) || newapiUserId <= 0) throw new Error('NewAPI user id was not returned');

  const login = await jsonRequest(config.newapiUrl, config.newapiLoginPath, '', { username, password }, config.newapiTimeoutMs);
  const loginData = responseData(login);
  const userToken = loginData?.token ?? loginData?.access_token;
  if (typeof userToken !== 'string' || !userToken) throw new Error('NewAPI login did not return a user token');
  const tokenName = `${username}-media`;
  await jsonRequest(config.newapiUrl, '/api/token/', userToken, {
    name: tokenName,
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
    model_limits_enabled: true,
    model_limits: config.verifiedModels.join(','),
    group: 'default',
  }, config.newapiTimeoutMs, { 'New-Api-User': String(newapiUserId) });
  const listResponse = await fetchWithTimeout(`${config.newapiUrl}/api/token/?p=1&size=100`, {
    headers: { authorization: `Bearer ${userToken}`, 'New-Api-User': String(newapiUserId) },
  }, config.newapiTimeoutMs);
  const listPayload = responseData(await listResponse.json());
  const tokens = listPayload?.items ?? listPayload ?? [];
  const createdToken = Array.isArray(tokens) ? tokens.find((item) => item.name === tokenName) : null;
  if (!listResponse.ok || !createdToken?.id) throw new Error('NewAPI media token was not found after creation');
  const tokenResponse = await fetchWithTimeout(`${config.newapiUrl}/api/token/${createdToken.id}/key`, {
    method: 'POST',
    headers: { authorization: `Bearer ${userToken}`, 'New-Api-User': String(newapiUserId) },
  }, config.newapiTimeoutMs);
  const tokenPayload = responseData(await tokenResponse.json());
  const mediaToken = typeof tokenPayload === 'string' ? tokenPayload : tokenPayload?.key;
  if (!tokenResponse.ok || typeof mediaToken !== 'string' || !mediaToken) throw new Error('NewAPI media token was not returned');
  return { newapiUserId, mediaToken };
}

export function findBill(payload, taskId) {
  const candidates = [];
  const visit = (value) => {
    if (!value || candidates.length > 1000) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    if (taskId && Object.values(value).some((item) => String(item) === String(taskId))) candidates.push(value);
    Object.values(value).forEach(visit);
  };
  visit(payload);
  const bill = candidates.find((item) => Number.isInteger(Number(item.quota ?? item.final_quota ?? item.used_quota)));
  if (!bill) return null;
  const finalQuota = Number(bill.quota ?? bill.final_quota ?? bill.used_quota);
  if (!Number.isInteger(finalQuota) || finalQuota < 0) return null;
  return { billId: String(bill.id ?? bill.log_id ?? taskId), finalQuota };
}
