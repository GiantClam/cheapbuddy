import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaignEmail,
  isBannedAccount,
  isEmailDomainBlacklisted,
  normalizeDomainBlacklist,
  selectNotificationRecipients,
  sendResendBatch,
} from './email-campaign.js';

test('normalizes domain blacklist entries and matches subdomains', () => {
  const blacklist = normalizeDomainBlacklist(' @spam.test, .example.invalid; disposable.test ');
  assert.deepEqual(blacklist, ['spam.test', 'example.invalid', 'disposable.test']);
  assert.equal(isEmailDomainBlacklisted('person@mail.spam.test', blacklist), true);
  assert.equal(isEmailDomainBlacklisted('person@safe.test', blacklist), false);
});

test('filters invalid, blacklisted, banned, and duplicate notification recipients', () => {
  const result = selectNotificationRecipients([
    { email: 'Active@Example.com', status: 'active' },
    { email: 'active@example.com', status: 'active' },
    { email: 'blocked@example.com', status: 'banned' },
    { email: 'disabled@example.com', disabled: true },
    { email: 'bad-email' },
    { email: 'person@spam.test', status: 'active' },
  ], { domainBlacklist: ['spam.test'] });
  assert.deepEqual(result.recipients, ['active@example.com']);
  assert.deepEqual(result.skipped, {
    invalidEmail: 1,
    blacklistedDomain: 1,
    bannedAccount: 2,
    duplicateEmail: 1,
  });
});

test('recognizes nested and explicit banned account states', () => {
  assert.equal(isBannedAccount({ user: { status: 'disabled' } }), true);
  assert.equal(isBannedAccount({ is_banned: true }), true);
  assert.equal(isBannedAccount({ status: 'active' }), false);
});

test('builds bilingual appreciation email content', () => {
  const email = buildCampaignEmail();
  assert.match(email.subject, /6 折/);
  assert.match(email.text, /60%/);
  assert.match(email.html, /cheapbuddy\.cc/);
});

test('sends Resend batches with one message per recipient', async () => {
  const calls = [];
  const result = await sendResendBatch({
    apiKey: 're_test',
    from: 'CheapBuddy <no-reply@cheapbuddy.cc>',
    recipients: ['one@example.com', 'two@example.com'],
    subject: 'Subject',
    text: 'Text',
    html: '<p>HTML</p>',
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), { status: 200 });
    },
  });
  assert.equal(result.batches, 1);
  assert.equal(result.recipients, 2);
  assert.equal(calls[0].url, 'https://api.resend.com/emails/batch');
  assert.equal(calls[0].body.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer re_test');
});
