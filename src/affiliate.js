export const CHEAPBUDDY_PUBLIC_ORIGIN = 'https://cheapbuddy.cc';

const AFFILIATE_CODE_PATTERN = /^[A-Z2-9]{4,32}$/;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeAffiliateCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return AFFILIATE_CODE_PATTERN.test(code) ? code : '';
}

export function getAffiliateCodeFromSearch(search) {
  return normalizeAffiliateCode(new URLSearchParams(search || '').get('aff'));
}

export function buildAffiliateInviteLink(code) {
  const validCode = normalizeAffiliateCode(code);
  if (!validCode) return '';
  const url = new URL('/register', CHEAPBUDDY_PUBLIC_ORIGIN);
  url.searchParams.set('aff', validCode);
  return url.toString();
}

export function normalizeAffiliateDetail(detail = {}) {
  const invitees = Array.isArray(detail.invitees) ? detail.invitees : [];
  return {
    affCode: normalizeAffiliateCode(detail.aff_code),
    invitedCount: Math.max(0, Math.trunc(finiteNumber(detail.aff_count))),
    availableQuota: Math.max(0, finiteNumber(detail.aff_quota)),
    frozenQuota: Math.max(0, finiteNumber(detail.aff_frozen_quota)),
    totalQuota: Math.max(0, finiteNumber(detail.aff_history_quota)),
    rebateRatePercent: Math.min(100, Math.max(0, finiteNumber(detail.effective_rebate_rate_percent))),
    invitees: invitees.map((invitee) => ({
      userId: finiteNumber(invitee?.user_id),
      email: String(invitee?.email || ''),
      username: String(invitee?.username || ''),
      totalRebate: Math.max(0, finiteNumber(invitee?.total_rebate)),
      createdAt: String(invitee?.created_at || ''),
    })),
  };
}
