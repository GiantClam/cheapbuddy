import { EmailMessage } from 'cloudflare:email';
import { addRechargeGuidance, isTextModelPath, isUserBalanceInsufficientResponse } from './balance-recharge.mjs';

const UPSTREAM_BASE = 'https://sub2api-production-493f.up.railway.app';
const RELAY_BASE = 'https://relay-prod-production-df4a.up.railway.app';
const PUBLIC_API_ADMIN_PREFIX = '/api/v1/admin';
const NOTICE_FROM = 'no-reply@cheapbuddy.cc';
const FORWARD_TO = 'bayswong@gmail.com';
const QUOTA_DELIVERY_CACHE_PREFIX = 'https://cheapbuddy-email-delivery.invalid/quota/';
const QUOTA_SIGNATURE_MAX_AGE_SECONDS = 300;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');
  // The upstream API also emits CORS headers. Remove them before applying the
  // website policy so the browser never receives duplicate origin values.
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  headers.delete('Access-Control-Allow-Headers');
  headers.delete('Access-Control-Allow-Methods');
  if (origin === 'https://cheapbuddy.cc' || origin === 'https://www.cheapbuddy.cc') {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Requested-With');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function safeText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isEmailAddress(value) {
  const email = safeText(value, 320);
  return email.length > 3 && !/[\r\n]/.test(email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hexFromBytes(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hexFromBytes(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function secureEquals(left, right) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function buildMimeMessage({ to, subject, text, html }) {
  const boundary = `cheapbuddy-${crypto.randomUUID()}`;
  const safeTo = safeText(to, 320).replace(/[\r\n]/g, '');
  const safeSubject = safeText(subject, 200).replace(/[\r\n]/g, '');
  return [`From: CheapBuddy <${NOTICE_FROM}>`, `To: ${safeTo}`, `Subject: =?UTF-8?B?${encodeBase64Utf8(safeSubject)}?=`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text, '', `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', html, '', `--${boundary}--`, ''].join('\r\n');
}

function quotaDeliveryMarker(eventId) {
  return new Request(`${QUOTA_DELIVERY_CACHE_PREFIX}${encodeURIComponent(eventId)}`);
}

async function handleQuotaNotify(request, env) {
  if (!env.QUOTA_NOTIFY_TOKEN) return json({ message: 'quota notification is not configured' }, 503);
  const timestamp = request.headers.get('X-CheapBuddy-Timestamp');
  const signature = request.headers.get('X-CheapBuddy-Signature') || '';
  const timestampSeconds = Number(timestamp);
  if (!/^\d{10}$/.test(timestamp || '') || !Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > QUOTA_SIGNATURE_MAX_AGE_SECONDS) {
    return json({ message: 'invalid or expired signature timestamp' }, 401);
  }
  const body = await request.text();
  if (body.length > 60000) return json({ message: 'request body too large' }, 413);
  const expected = await hmacSha256Hex(env.QUOTA_NOTIFY_TOKEN, `${timestamp}.${body}`);
  const provided = signature.replace(/^sha256=/, '').toLowerCase();
  if (!(await secureEquals(provided, expected))) return json({ message: 'invalid signature' }, 401);

  let payload;
  try { payload = JSON.parse(body); } catch { return json({ message: 'invalid JSON' }, 400); }
  const eventId = safeText(payload?.event_id, 200);
  const recipient = safeText(payload?.recipient, 320).toLowerCase();
  const subject = safeText(payload?.subject, 200);
  const html = safeText(payload?.html, 50000);
  const text = safeText(payload?.text, 20000);
  if (!eventId || !isEmailAddress(recipient) || !subject || !html) return json({ message: 'event_id, recipient, subject, and html are required' }, 400);
  const marker = quotaDeliveryMarker(eventId);
  if (await caches.default.match(marker)) return json({ ok: true, duplicate: true });
  try {
    await env.NOTICE_EMAIL.send(new EmailMessage(NOTICE_FROM, recipient, buildMimeMessage({
      to: recipient,
      subject,
      text: text || subject,
      html,
    })));
    await caches.default.put(marker, new Response('sent', { headers: { 'Cache-Control': 'public, max-age=31536000' } }));
    return json({ ok: true, sent: true });
  } catch (error) {
    console.error('quota notification email delivery failed', error);
    return json({ message: 'email delivery failed' }, 502);
  }
}

async function enrichUserBalanceError(response, pathname) {
  // Successful and streaming model responses must pass through untouched. Only
  // bounded JSON errors from public text routes are eligible for enrichment.
  if (response.ok || !isTextModelPath(pathname) || !response.headers.get('Content-Type')?.includes('application/json')) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!isUserBalanceInsufficientResponse(payload, response.status)) return response;

  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  const status = response.status === 403 ? 402 : response.status;
  return new Response(JSON.stringify(addRechargeGuidance(payload, response.status)), {
    status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async email(message) {
    try { await message.forward(FORWARD_TO); } catch (error) { console.error('inbound email forwarding failed', error); message.setReject('Forwarding temporarily unavailable'); }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);
    const internalPath = url.pathname.startsWith('/api/internal/') ? url.pathname.slice('/api'.length) : url.pathname.startsWith('/v1/internal/') ? url.pathname.slice('/v1'.length) : url.pathname;
    if (internalPath === '/internal/quota-notify' && request.method === 'POST') return withCors(await handleQuotaNotify(request, env), request);
    if (url.pathname === '/health' && request.method === 'GET') return withCors(json({ ok: true }), request);
    if (url.pathname === PUBLIC_API_ADMIN_PREFIX || url.pathname.startsWith(`${PUBLIC_API_ADMIN_PREFIX}/`)) return withCors(json({ message: '管理接口仅对私有管理域名开放' }, 404), request);
    // Use the same gateway for browser checks and exported client configs so
    // model discovery, media, and inference share the Relay's public contract.
    const upstreamBase = url.pathname === '/v1' || url.pathname.startsWith('/v1/') ? RELAY_BASE : UPSTREAM_BASE;
    const upstreamUrl = new URL(`${url.pathname}${url.search}`, upstreamBase);
    const upstreamResponse = await fetch(new Request(upstreamUrl, request));
    return withCors(await enrichUserBalanceError(upstreamResponse, url.pathname), request);
  },
};
