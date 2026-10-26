import assert from 'node:assert/strict';
import test from 'node:test';
import { getRegistrationVerificationPayload, hasValidRegistrationVerification, isEmailVerificationEnabled, isEmailVerificationRequiredError } from './auth-registration.js';

test('email verification follows an explicit public setting', () => {
  assert.equal(isEmailVerificationEnabled({ email_verify_enabled: true }), true);
  assert.equal(isEmailVerificationEnabled({ email_verify_enabled: false }), false);
});

test('email verification stays enabled when public settings are unavailable or incomplete', () => {
  assert.equal(isEmailVerificationEnabled(null), true);
  assert.equal(isEmailVerificationEnabled(undefined), true);
  assert.equal(isEmailVerificationEnabled({}), true);
});

test('registration verification is bypassed only when the setting explicitly disables it', () => {
  const registration = {
    emailVerificationEnabled: isEmailVerificationEnabled({ email_verify_enabled: false }),
    email: 'user@example.com',
    verificationEmail: '',
    verificationCode: '',
  };
  assert.equal(hasValidRegistrationVerification(registration), true);
});

test('registration verification requires a matching email and six-digit code when enabled', () => {
  const registration = {
    emailVerificationEnabled: true,
    email: ' User@Example.com ',
    verificationEmail: 'user@example.com',
    verificationCode: '123456',
  };
  assert.equal(hasValidRegistrationVerification(registration), true);
  assert.equal(hasValidRegistrationVerification({ ...registration, verificationEmail: 'other@example.com' }), false);
  assert.equal(hasValidRegistrationVerification({ ...registration, verificationCode: '12345' }), false);
});

test('registration sends Turnstile proof when email verification is disabled', () => {
  assert.deepEqual(getRegistrationVerificationPayload({
    emailVerificationEnabled: false,
    turnstileToken: 'turnstile-proof',
    verificationCode: '',
  }), { turnstileToken: 'turnstile-proof', verificationCode: '' });
});

test('registration keeps the existing email verification payload when it is enabled', () => {
  assert.deepEqual(getRegistrationVerificationPayload({
    emailVerificationEnabled: true,
    turnstileToken: 'unused-after-email-check',
    verificationCode: '123456',
  }), { turnstileToken: '', verificationCode: '123456' });
});

test('recognizes a backend email verification policy response', () => {
  assert.equal(isEmailVerificationRequiredError(new Error('email verification is required')), true);
  assert.equal(isEmailVerificationRequiredError(new Error('邮箱验证是必需的')), true);
  assert.equal(isEmailVerificationRequiredError(new Error('invalid verification code')), false);
});
