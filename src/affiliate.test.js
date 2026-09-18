import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAffiliateInviteLink,
  getAffiliateCodeFromSearch,
  normalizeAffiliateDetail,
} from './affiliate.js';

test('builds a public registration link from a valid affiliate code', () => {
  assert.equal(
    buildAffiliateInviteLink('ABCD2345'),
    'https://cheapbuddy.cc/register?aff=ABCD2345',
  );
});

test('does not expose invalid affiliate codes in a link or registration payload', () => {
  assert.equal(buildAffiliateInviteLink('not a valid code'), '');
  assert.equal(getAffiliateCodeFromSearch('?aff=bad%20code'), '');
});

test('normalizes the Sub2API affiliate summary for the account view', () => {
  assert.deepEqual(normalizeAffiliateDetail({
    aff_code: 'ABCD2345',
    aff_count: 2,
    aff_quota: 12.5,
    aff_frozen_quota: 3,
    aff_history_quota: 20,
    effective_rebate_rate_percent: 10,
    invitees: [{ user_id: 12, email: 'a***@e***.com', username: 'Alex', total_rebate: 8.5 }],
  }), {
    affCode: 'ABCD2345',
    invitedCount: 2,
    availableQuota: 12.5,
    frozenQuota: 3,
    totalQuota: 20,
    rebateRatePercent: 10,
    invitees: [{ userId: 12, email: 'a***@e***.com', username: 'Alex', totalRebate: 8.5, createdAt: '' }],
  });
});
