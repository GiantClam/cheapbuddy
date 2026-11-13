const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const BANNED_ACCOUNT_STATUSES = new Set([
  'banned',
  'blocked',
  'deactivated',
  'deleted',
  'disabled',
  'suspended',
]);

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
}

export function normalizeDomainBlacklist(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  return [...new Set(entries
    .map((entry) => String(entry || '').trim().toLowerCase().replace(/^@+/, '').replace(/^\.+/, '').replace(/\.+$/, ''))
    .filter(Boolean))];
}

export function isEmailDomainBlacklisted(email, blacklist) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1);
  return normalizeDomainBlacklist(blacklist).some((rule) => domain === rule || domain.endsWith(`.${rule}`));
}

export function isBannedAccount(account) {
  const user = account?.user && typeof account.user === 'object' ? { ...account, ...account.user } : account;
  const status = String(user?.status || user?.account_status || user?.user_status || '').trim().toLowerCase();
  return Boolean(user?.banned || user?.is_banned || user?.disabled || user?.is_disabled || user?.deleted)
    || BANNED_ACCOUNT_STATUSES.has(status);
}

export function selectNotificationRecipients(users, { domainBlacklist = [] } = {}) {
  const recipients = [];
  const seen = new Set();
  const skipped = {
    invalidEmail: 0,
    blacklistedDomain: 0,
    bannedAccount: 0,
    duplicateEmail: 0,
  };

  for (const account of Array.isArray(users) ? users : []) {
    const user = account?.user && typeof account.user === 'object' ? { ...account, ...account.user } : account;
    if (isBannedAccount(user)) {
      skipped.bannedAccount += 1;
      continue;
    }
    const email = normalizeEmail(user?.email);
    if (!email) {
      skipped.invalidEmail += 1;
      continue;
    }
    if (isEmailDomainBlacklisted(email, domainBlacklist)) {
      skipped.blacklistedDomain += 1;
      continue;
    }
    if (seen.has(email)) {
      skipped.duplicateEmail += 1;
      continue;
    }
    seen.add(email);
    recipients.push(email);
  }

  return { recipients, skipped };
}

export function buildCampaignEmail() {
  const subject = 'CheapBuddy 全模型官网价 6 折回馈';
  const text = [
    '感谢您一段时间以来对 CheapBuddy 的支持。',
    '',
    '为回馈用户，现将全部模型客户价格调整为官网参考价的 6 折，按实际 Token / 媒体用量结算。',
    '',
    '欢迎登录官网查看当前模型与价格：https://cheapbuddy.cc/',
    '',
    'Thank you for supporting CheapBuddy. All model customer rates are now set to 60% of official reference pricing and billed by actual usage.',
  ].join('\n');
  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.7;color:#17252b">',
    '<p>感谢您一段时间以来对 CheapBuddy 的支持。</p>',
    '<p>为回馈用户，现将全部模型客户价格调整为官网参考价的 <strong>6 折</strong>，按实际 Token / 媒体用量结算。</p>',
    '<p><a href="https://cheapbuddy.cc/">登录 CheapBuddy 查看当前模型与价格</a></p>',
    '<hr style="border:0;border-top:1px solid #dce5e7;margin:24px 0">',
    '<p>Thank you for supporting CheapBuddy. All model customer rates are now set to <strong>60% of official reference pricing</strong> and billed by actual usage.</p>',
    '</div>',
  ].join('');
  return { subject, text, html };
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function sendResendBatch({ apiKey, from, recipients, subject, text, html, fetchImpl = globalThis.fetch, batchSize = 100 }) {
  if (!String(apiKey || '').trim()) throw new Error('RESEND_API_KEY is required');
  if (!String(from || '').trim()) throw new Error('RESEND_FROM_EMAIL is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const normalizedRecipients = [...new Set((recipients || []).map(normalizeEmail).filter(Boolean))];
  const batches = chunk(normalizedRecipients, batchSize);
  const responses = [];

  for (const [index, batch] of batches.entries()) {
    const response = await fetchImpl('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch.map((to) => ({ from, to: [to], subject, text, html }))),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Resend batch ${index + 1} failed (${response.status}): ${payload.message || 'unknown error'}`);
    }
    responses.push(payload);
  }

  return { batches: batches.length, recipients: normalizedRecipients.length, responses };
}
