import {
  buildCampaignEmail,
  normalizeDomainBlacklist,
  selectNotificationRecipients,
  sendResendBatch,
} from '../src/email-campaign.js';

const API_BASE_URL = String(process.env.SUB2API_ADMIN_API_BASE_URL || process.env.CHEAPBUDDY_ADMIN_API_BASE_URL || '').replace(/\/+$/, '');
const ADMIN_TOKEN = String(process.env.SUB2API_ADMIN_TOKEN || process.env.CHEAPBUDDY_ADMIN_TOKEN || '').trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM_EMAIL = String(process.env.RESEND_FROM_EMAIL || 'CheapBuddy <no-reply@cheapbuddy.cc>').trim();
const DOMAIN_BLACKLIST = normalizeDomainBlacklist(process.env.EMAIL_DOMAIN_BLACKLIST || process.env.EMAIL_SUFFIX_BLACKLIST || '');
const isSend = process.argv.includes('--send');

function requireConfiguration() {
  if (!API_BASE_URL || !/^https?:\/\//i.test(API_BASE_URL)) throw new Error('SUB2API_ADMIN_API_BASE_URL must be an absolute URL');
  if (!ADMIN_TOKEN) throw new Error('SUB2API_ADMIN_TOKEN is required');
  if (!DOMAIN_BLACKLIST.length) throw new Error('EMAIL_DOMAIN_BLACKLIST is required; refuse to send without an explicit blacklist');
  if (isSend && !RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when using --send');
}

function extractUsers(payload) {
  const candidates = [payload, payload?.data, payload?.items, payload?.users, payload?.data?.items, payload?.data?.users];
  return candidates.find(Array.isArray) || [];
}

async function listAllUsers() {
  const users = [];
  for (let page = 1; page <= 1000; page += 1) {
    const response = await fetch(`${API_BASE_URL}/admin/users?page=${page}&page_size=1000`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Unable to list users (${response.status}): ${payload.message || 'unknown error'}`);
    const items = extractUsers(payload);
    users.push(...items);
    const total = Number(payload?.total ?? payload?.data?.total);
    if (items.length === 0 || (Number.isFinite(total) && users.length >= total) || items.length < 1000) break;
  }
  return users;
}

async function main() {
  requireConfiguration();
  const users = await listAllUsers();
  const selection = selectNotificationRecipients(users, { domainBlacklist: DOMAIN_BLACKLIST });
  console.log(JSON.stringify({
    mode: isSend ? 'send' : 'preview',
    users: users.length,
    recipients: selection.recipients.length,
    skipped: selection.skipped,
    blacklistDomains: DOMAIN_BLACKLIST,
  }, null, 2));
  if (!isSend) return;

  const result = await sendResendBatch({
    apiKey: RESEND_API_KEY,
    from: RESEND_FROM_EMAIL,
    recipients: selection.recipients,
    ...buildCampaignEmail(),
  });
  console.log(JSON.stringify({ sent: result.recipients, batches: result.batches }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
