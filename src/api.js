// Keep user-facing account and announcement requests on the CheapBuddy origin.
// Deployments can override this for a separate console, but the default remains same-origin.
import { normalizeAffiliateCode } from './affiliate.js';
import { CLAUDE_API_KEY_GROUP_ID, OPENAI_API_KEY_GROUP_ID } from './key-groups.js';

const API_BASE_URL = String(import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');
const STRIPE_PAYMENT_BASE_URL = String(import.meta.env?.VITE_SUB2API_STRIPE_PAYMENT_URL || '').trim().replace(/\/+$/, '');
const MEDIA_USAGE_API_BASE_URL = String(import.meta.env?.VITE_MEDIA_USAGE_API_BASE_URL || import.meta.env?.VITE_WORKBUDDY_BASE_URL || 'https://api.cheapbuddy.cc')
  .replace(/\/+$/, '')
  .replace(/\/v1$/, '');
export const API_REQUEST_TIMEOUT_MS = 20_000;
const pendingSharedApiKeys = new Map();

export class ApiRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = details.status;
    this.code = details.code;
    this.reason = details.reason;
    this.metadata = details.metadata;
  }
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function getAuthToken() {
  return window.localStorage.getItem('cheapbuddy_auth_token');
}

export function getSavedUser() {
  try {
    const raw = window.localStorage.getItem('cheapbuddy_auth_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(data) {
  window.localStorage.setItem('cheapbuddy_auth_token', data.access_token);
  if (data.refresh_token) window.localStorage.setItem('cheapbuddy_refresh_token', data.refresh_token);
  if (data.user) window.localStorage.setItem('cheapbuddy_auth_user', JSON.stringify(data.user));
}

export function clearSession() {
  window.localStorage.removeItem('cheapbuddy_auth_token');
  window.localStorage.removeItem('cheapbuddy_refresh_token');
  window.localStorage.removeItem('cheapbuddy_auth_user');
}

async function request(path, options = {}) {
  const { timeoutMs = API_REQUEST_TIMEOUT_MS, signal: callerSignal, authToken = getAuthToken(), ...fetchOptions } = options;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId;
  let timedOut = false;
  let removeCallerAbortListener;

  if (controller) {
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else {
        const abortCallerRequest = () => controller.abort(callerSignal.reason);
        callerSignal.addEventListener('abort', abortCallerRequest, { once: true });
        removeCallerAbortListener = () => callerSignal.removeEventListener('abort', abortCallerRequest);
      }
    }
    if (!controller.signal.aborted && timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }
    fetchOptions.signal = controller.signal;
  } else if (callerSignal) {
    fetchOptions.signal = callerSignal;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...fetchOptions, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
      const errorBody = body.error && typeof body.error === 'object' ? body.error : body;
      throw new ApiRequestError(
        body.message || errorBody.message || `请求失败（${response.status}）`,
        {
          status: response.status,
          code: body.code || errorBody.code,
          reason: body.reason || errorBody.reason,
          metadata: body.metadata || errorBody.metadata,
        },
      );
    }
    return Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  } catch (error) {
    if (timedOut) {
      throw new ApiRequestError('请求超时，请刷新返利数据后重试，避免重复转账', {
        status: 408,
        code: 'REQUEST_TIMEOUT',
        reason: 'REQUEST_TIMEOUT',
      });
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    removeCallerAbortListener?.();
  }
}

export function loginUser(email, password, turnstileToken = '') {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, turnstile_token: turnstileToken || undefined }),
  });
}

export function sendVerificationCode(email, turnstileToken = '') {
  return request('/auth/send-verify-code', {
    method: 'POST',
    body: JSON.stringify({ email, turnstile_token: turnstileToken || undefined }),
  });
}

export function verifyAdminAccess() {
  return request('/admin/users?page=1&page_size=1');
}

export function registerUser(email, password, turnstileToken = '', affiliateCode = '', verificationCode = '') {
  const affCode = normalizeAffiliateCode(affiliateCode);
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      verify_code: String(verificationCode || '').trim() || undefined,
      turnstile_token: turnstileToken || undefined,
      aff_code: affCode || undefined,
    }),
  });
}

export function getPublicSettings() {
  return request('/settings/public');
}

export function getProfile() {
  return request('/user/profile');
}

export function getAffiliateDetail() {
  return request('/user/aff');
}

export function transferAffiliateQuota(options = {}) {
  return request('/user/aff/transfer', { method: 'POST', ...options });
}

export function getUsageDashboardStats() {
  return request('/usage/dashboard/stats');
}

export function getUsageDashboardModels(params) {
  const query = new URLSearchParams(params).toString();
  return request(`/usage/dashboard/models${query ? `?${query}` : ''}`);
}

export async function getMediaUsageDashboardModels(apiKey, params) {
  if (!apiKey) return { models: [], summary: {} };
  const query = new URLSearchParams(params).toString();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS) : null;
  let response;
  try {
    response = await fetch(`${MEDIA_USAGE_API_BASE_URL}/v1/usage/dashboard/media${query ? `?${query}` : ''}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller?.signal,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorBody = body.error && typeof body.error === 'object' ? body.error : body;
    throw new ApiRequestError(errorBody.message || `请求失败（${response.status}）`, { status: response.status, code: errorBody.code });
  }
  return body.data ?? body;
}

export async function listAnnouncements() {
  const result = await request('/announcements');
  const candidates = [result, result?.items, result?.announcements, result?.data, result?.data?.items];
  return candidates.find(Array.isArray) || [];
}

export async function listApiKeys() {
  const result = await request('/keys?page=1&page_size=20');
  return result?.items || result?.data || [];
}

export function createApiKey(name, groupId, authToken = getAuthToken()) {
  return request('/keys', { method: 'POST', body: JSON.stringify({ name, group_id: groupId }), authToken });
}

export function findApiKeyForGroup(keys, groupId) {
  const targetGroupId = Number(groupId);
  if (!Array.isArray(keys) || !Number.isSafeInteger(targetGroupId) || targetGroupId <= 0) return undefined;
  const inGroup = (item) => Number(item?.group_id) === targetGroupId;
  return keys.find((item) => inGroup(item) && item.status === 'active')
    || keys.find(inGroup);
}

export async function getOrCreateApiKey(groupId = OPENAI_API_KEY_GROUP_ID) {
  const targetGroupId = Number(groupId);
  if (!Number.isSafeInteger(targetGroupId) || targetGroupId <= 0) {
    throw new ApiRequestError('无效的 API Key 分组');
  }
  const keys = await listApiKeys();
  const existing = findApiKeyForGroup(keys, targetGroupId);
  const name = targetGroupId === CLAUDE_API_KEY_GROUP_ID ? 'CheapBuddy Claude' : 'CheapBuddy WorkBuddy';
  const key = existing || await createApiKey(name, targetGroupId);
  return key?.key || '';
}

async function listAllApiKeys(authToken) {
  let keys = [];
  for (let page = 1; page <= 1000; page += 1) {
    const result = await request(`/keys?page=${page}&page_size=20`, { authToken });
    const items = Array.isArray(result) ? result : result?.items || result?.data;
    if (!Array.isArray(items)) {
      throw new ApiRequestError('无法读取 API Key 列表', { code: 'INVALID_API_KEY_LIST' });
    }
    keys = [...keys, ...items];
    if (Array.isArray(result)) return keys;
    const total = Number(result.total);
    const hasTotal = result.total != null && Number.isSafeInteger(total) && total >= 0;
    if (hasTotal && keys.length >= total) return keys;
    if (items.length === 0 && hasTotal) break;
    const pageSize = Number(result.page_size) || 20;
    if (!hasTotal && items.length < pageSize) return keys;
  }
  throw new ApiRequestError('API Key 列表分页不完整，请刷新后重试', { code: 'INVALID_API_KEY_LIST' });
}

function requireUsableSharedKey(key) {
  const expired = key?.expires_at && Date.parse(key.expires_at) <= Date.now();
  const exhausted = Number(key?.quota) > 0 && Number(key?.quota_used) >= Number(key.quota);
  const groupId = Number(key?.group?.id);
  const invalidGroup = key?.group && (key.group.status !== 'active'
    || !Number.isSafeInteger(groupId) || groupId <= 0 || Number(key.group_id) !== groupId);
  if (!key?.key || key.status !== 'active' || invalidGroup || expired || exhausted) {
    throw new ApiRequestError('当前统一 API Key 已禁用、过期或额度不足，请在账户中心检查', { code: 'API_KEY_UNAVAILABLE' });
  }
  return key.key;
}

async function resolveSharedApiKey(authToken) {
  const configured = String(import.meta.env?.VITE_CHEAPBUDDY_SHARED_GROUP_ID || '').trim();
  const configuredGroupId = configured ? Number(configured) : null;
  if (configured && (!Number.isSafeInteger(configuredGroupId) || configuredGroupId <= 0)) {
    throw new ApiRequestError('统一 API Key 分组配置无效', { code: 'INVALID_SHARED_API_KEY_GROUP' });
  }
  const keys = await listAllApiKeys(authToken);
  const compositeKeys = keys.filter((item) => item?.group?.platform === 'composite'
    && (!configuredGroupId || Number(item.group_id) === configuredGroupId));
  const existing = compositeKeys.find((item) => item.status === 'active') || compositeKeys[0];
  if (existing) return requireUsableSharedKey(existing);

  const groups = await request('/groups/available', { authToken });
  const available = Array.isArray(groups) ? groups : Array.isArray(groups?.items) ? groups.items : [];
  const group = available.find((item) => item?.platform === 'composite' && item.status === 'active'
    && Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0
    && (!configuredGroupId || Number(item.id) === configuredGroupId));
  if (!group) {
    throw new ApiRequestError('当前账户没有可用的统一模型分组，请联系管理员配置 OpenAI 和 Claude 共享分组', {
      code: 'SHARED_API_KEY_GROUP_UNAVAILABLE',
    });
  }
  const matching = keys.filter((item) => Number(item?.group_id) === Number(group.id));
  const matchingKey = matching.find((item) => item.status === 'active') || matching[0];
  if (matchingKey) return requireUsableSharedKey({ ...matchingKey, group: matchingKey.group || group });
  const created = await createApiKey('CheapBuddy Shared', group.id, authToken);
  // The create endpoint may omit status; it never omits the newly issued key.
  return requireUsableSharedKey({ status: 'active', group_id: group.id, ...created, group });
}

async function verifyApiKeyModels(apiKey, baseUrl, models) {
  const endpoint = String(baseUrl || `${MEDIA_USAGE_API_BASE_URL}/v1`).replace(/\/+$/, '');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS) : null;
  let response;
  let body;
  try {
    response = await fetch(`${endpoint}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller?.signal,
    });
    body = await response.json().catch(() => ({})) || {};
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
    const errorBody = body.error && typeof body.error === 'object' ? body.error : body;
    throw new ApiRequestError(errorBody.message || `模型权限检查失败（${response.status}）`, {
      status: response.status, code: errorBody.code, reason: errorBody.reason,
    });
  }
  const catalog = Array.isArray(body.data) ? body.data : body.data?.data;
  if (!Array.isArray(catalog)) {
    throw new ApiRequestError('模型目录响应无效，无法确认 API Key 权限', { code: 'INVALID_MODEL_CATALOG' });
  }
  const visibleModels = new Set(catalog.map((item) => String(item?.id || '').trim()));
  // Client configurations export the public ID; provider aliases are translated downstream.
  const selectedIds = (models || []).map((model) => String(model?.id || '').trim());
  const missingModels = [...new Set(selectedIds.filter((id) => !visibleModels.has(id)))];
  if (missingModels.length > 0) {
    throw new ApiRequestError(`当前 API Key 无法访问所选模型：${missingModels.join('、')}`, {
      code: 'API_KEY_MODELS_UNAVAILABLE', metadata: { missingModels },
    });
  }
}

export async function getOrCreateSharedApiKey({ baseUrl, models = [], apiKey, validateModels = true } = {}) {
  let key = String(apiKey || '').trim();
  if (!key) {
    const authToken = getAuthToken();
    let pending = pendingSharedApiKeys.get(authToken);
    if (!pending) {
      pending = resolveSharedApiKey(authToken).finally(() => {
        if (pendingSharedApiKeys.get(authToken) === pending) pendingSharedApiKeys.delete(authToken);
      });
      pendingSharedApiKeys.set(authToken, pending);
    }
    key = await pending;
  }
  if (validateModels !== false) await verifyApiKeyModels(key, baseUrl, models);
  return key;
}

export function getCheckoutInfo() {
  return request('/payment/checkout-info');
}

export function createPaymentOrder(payload) {
  return request('/payment/orders', { method: 'POST', body: JSON.stringify(payload) });
}

export function buildStripePaymentUrl({ orderId, clientSecret, resumeToken = '' }) {
  if (!orderId || !clientSecret) return '';
  const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const baseUrl = STRIPE_PAYMENT_BASE_URL || new URL(API_BASE_URL, fallbackOrigin).origin;
  const url = new URL('/payment/stripe', baseUrl);
  url.searchParams.set('order_id', String(orderId));
  url.searchParams.set('client_secret', String(clientSecret));
  if (resumeToken) url.searchParams.set('resume_token', String(resumeToken));
  return url.toString();
}

export function listPaymentOrders(params = {}) {
  const query = new URLSearchParams({ page: '1', page_size: '50', ...params }).toString();
  return request(`/payment/orders/my?${query}`);
}

export function cancelPaymentOrder(orderId) {
  return request(`/payment/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' });
}
