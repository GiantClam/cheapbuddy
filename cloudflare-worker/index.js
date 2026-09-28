import { EmailMessage } from 'cloudflare:email';
import { addRechargeGuidance, isTextModelPath, isUserBalanceInsufficientResponse } from './balance-recharge.mjs';

const UPSTREAM_BASE = 'https://sub2api-production-493f.up.railway.app';
const SUB2API_ADMIN_BASE = 'https://admin.cheapbuddy.cc';
const PUBLIC_API_ADMIN_PREFIX = '/api/v1/admin';
const NOTICE_FROM = 'notice@cheapbuddy.cc';
const FORWARD_TO = 'bayswong@gmail.com';
const DELIVERY_CACHE_PREFIX = 'https://cheapbuddy-email-delivery.invalid/announcement/';

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

function unauthorized() {
  return json({ message: 'Unauthorized' }, 401);
}

function safeText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return safeText(value, 20000).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function markdownToHtml(markdown) {
  return escapeHtml(markdown).split(/\r?\n\r?\n/).map((paragraph) => {
    const lines = paragraph.split('\n');
    if (lines.every((line) => /^\s*-\s+/.test(line))) return `<ul>${lines.map((line) => `<li>${line.replace(/^\s*-\s+/, '')}</li>`).join('')}</ul>`;
    const heading = paragraph.match(/^#{1,3}\s+(.+)$/);
    return heading ? `<h2>${heading[1]}</h2>` : `<p>${paragraph.replaceAll('\n', '<br>')}</p>`;
  }).join('');
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildMimeMessage({ to, subject, text, html }) {
  const boundary = `cheapbuddy-${crypto.randomUUID()}`;
  return [`From: CheapBuddy <${NOTICE_FROM}>`, `To: ${to}`, `Subject: =?UTF-8?B?${encodeBase64Utf8(subject)}?=`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', text, '', `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', html, '', `--${boundary}--`, ''].join('\r\n');
}

async function sendAnnouncementEmail(env, recipient, announcement) {
  const title = safeText(announcement.title, 200) || '服务公告';
  const content = safeText(announcement.content, 20000);
  const subject = `[CheapBuddy] ${title}`;
  const text = `${title}\n\n${content}\n\nCheapBuddy · https://cheapbuddy.cc`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#24343b"><h1>${escapeHtml(title)}</h1>${markdownToHtml(content)}<p style="margin-top:28px;color:#71858d;font-size:13px">CheapBuddy · <a href="https://cheapbuddy.cc">cheapbuddy.cc</a></p></div>`;
  await env.NOTICE_EMAIL.send(new EmailMessage(NOTICE_FROM, recipient, buildMimeMessage({ to: recipient, subject, text, html })));
}

async function deliveryMarker(recipient, announcementId) {
  return new Request(`${DELIVERY_CACHE_PREFIX}${encodeURIComponent(announcementId)}/${encodeURIComponent(recipient)}`);
}

async function wasDelivered(recipient, announcementId) {
  return Boolean(await caches.default.match(await deliveryMarker(recipient, announcementId)));
}

async function markDelivered(recipient, announcementId) {
  await caches.default.put(await deliveryMarker(recipient, announcementId), new Response('sent', { headers: { 'Cache-Control': 'public, max-age=31536000' } }));
}

async function getAdminToken(env) {
  const response = await fetch(`${SUB2API_ADMIN_BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.SUB2API_ADMIN_EMAIL, password: env.SUB2API_ADMIN_PASSWORD }) });
  if (!response.ok) throw new Error(`admin login failed: ${response.status}`);
  const body = await response.json();
  if (!body?.data?.access_token) throw new Error('admin login returned no access token');
  return body.data.access_token;
}

async function getAdminResource(path, token) {
  const response = await fetch(`${SUB2API_ADMIN_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`admin request failed: ${response.status}`);
  const body = await response.json();
  return body?.data || body;
}

async function syncAnnouncements(env) {
  if (!env.SUB2API_ADMIN_EMAIL || !env.SUB2API_ADMIN_PASSWORD || !env.NOTICE_EMAIL) throw new Error('email sync secrets are not configured');
  const token = await getAdminToken(env);
  const [announcementResult, userResult] = await Promise.all([getAdminResource('/api/v1/admin/announcements?page=1&page_size=100&status=active', token), getAdminResource('/api/v1/admin/users?page=1&page_size=100', token)]);
  const announcements = announcementResult?.items || [];
  const recipients = (userResult?.items || []).filter((user) => user?.role === 'user' && user?.status === 'active' && user?.email).map((user) => user.email);
  let sent = 0;
  for (const announcement of announcements) {
    const id = safeText(announcement.id, 100);
    if (!id) continue;
    for (const recipient of recipients) {
      const email = safeText(recipient, 320).toLowerCase();
      if (!email || email === NOTICE_FROM || await wasDelivered(email, id)) continue;
      await sendAnnouncementEmail(env, email, announcement);
      await markDelivered(email, id);
      sent += 1;
    }
  }
  return { announcements: announcements.length, recipients: recipients.length, sent };
}

async function handleAnnouncementSend(request, env) {
  if (!env.ANNOUNCEMENT_SEND_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.ANNOUNCEMENT_SEND_TOKEN}`) return unauthorized();
  let payload;
  try { payload = await request.json(); } catch { return json({ message: 'Invalid JSON' }, 400); }
  const announcement = payload?.announcement;
  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
  if (!announcement?.id || !announcement?.title || !announcement?.content || recipients.length === 0) return json({ message: 'announcement id, title, content, and recipients are required' }, 400);
  if (recipients.length > 500) return json({ message: 'too many recipients' }, 400);
  try {
    let sent = 0;
    for (const recipient of recipients) {
      const email = safeText(recipient, 320).toLowerCase();
      if (!email || email === NOTICE_FROM || await wasDelivered(email, announcement.id)) continue;
      await sendAnnouncementEmail(env, email, announcement);
      await markDelivered(email, announcement.id);
      sent += 1;
    }
    return json({ ok: true, sent });
  } catch (error) {
    console.error('announcement email delivery failed', error);
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
  return new Response(JSON.stringify(addRechargeGuidance(payload)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async email(message) {
    try { await message.forward(FORWARD_TO); } catch (error) { console.error('inbound email forwarding failed', error); message.setReject('Forwarding temporarily unavailable'); }
  },
  async scheduled(_controller, env) {
    try { console.log('announcement email sync complete', await syncAnnouncements(env)); } catch (error) { console.error('announcement email sync failed', error); }
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request);
    const internalPath = url.pathname.startsWith('/api/internal/') ? url.pathname.slice('/api'.length) : url.pathname.startsWith('/v1/internal/') ? url.pathname.slice('/v1'.length) : url.pathname;
    if (internalPath === '/internal/send-announcement' && request.method === 'POST') return withCors(await handleAnnouncementSend(request, env), request);
    if (internalPath === '/internal/sync-announcements' && request.method === 'POST') {
      if (!env.ANNOUNCEMENT_SEND_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.ANNOUNCEMENT_SEND_TOKEN}`) return withCors(unauthorized(), request);
      try { return withCors(json({ ok: true, ...(await syncAnnouncements(env)) }), request); } catch (error) { console.error('manual announcement sync failed', error); return withCors(json({ message: 'email sync failed' }, 502), request); }
    }
    if (url.pathname === '/health' && request.method === 'GET') return withCors(json({ ok: true }), request);
    if (url.pathname === PUBLIC_API_ADMIN_PREFIX || url.pathname.startsWith(`${PUBLIC_API_ADMIN_PREFIX}/`)) return withCors(json({ message: '管理接口仅对私有管理域名开放' }, 404), request);
    const upstreamUrl = new URL(`${url.pathname}${url.search}`, UPSTREAM_BASE);
    const upstreamResponse = await fetch(new Request(upstreamUrl, request));
    return withCors(await enrichUserBalanceError(upstreamResponse, url.pathname), request);
  },
};
