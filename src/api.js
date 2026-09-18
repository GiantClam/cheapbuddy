// Keep user-facing account and announcement requests on the CheapBuddy origin.
// Deployments can override this for a separate console, but the default remains same-origin.
import { normalizeAffiliateCode } from './affiliate.js';

const API_BASE_URL = String(import.meta.env?.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');

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
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (typeof body.code === 'number' && body.code !== 0)) {
    throw new Error(body.message || body.error?.message || `请求失败（${response.status}）`);
  }
  return Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
}

export function loginUser(email, password, turnstileToken = '') {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, turnstile_token: turnstileToken || undefined }),
  });
}

export function verifyAdminAccess() {
  return request('/admin/users?page=1&page_size=1');
}

export function registerUser(email, password, turnstileToken = '', affiliateCode = '') {
  const affCode = normalizeAffiliateCode(affiliateCode);
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
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

export function transferAffiliateQuota() {
  return request('/user/aff/transfer', { method: 'POST' });
}

export function getUsageDashboardStats() {
  return request('/usage/dashboard/stats');
}

export function getUsageDashboardModels(params) {
  const query = new URLSearchParams(params).toString();
  return request(`/usage/dashboard/models${query ? `?${query}` : ''}`);
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

export function createApiKey(name, groupId) {
  return request('/keys', { method: 'POST', body: JSON.stringify({ name, group_id: groupId }) });
}

export function getCheckoutInfo() {
  return request('/payment/checkout-info');
}

export function createPaymentOrder(payload) {
  return request('/payment/orders', { method: 'POST', body: JSON.stringify(payload) });
}
