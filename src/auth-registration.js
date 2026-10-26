export function isEmailVerificationEnabled(settings) {
  return settings?.email_verify_enabled !== false;
}

export function isEmailVerificationRequiredError(error) {
  const message = String(error?.message || '');
  return /email verification is required/i.test(message) || /邮箱验证.*(?:必需|需要)/.test(message);
}

export function hasValidRegistrationVerification({ emailVerificationEnabled, email, verificationEmail, verificationCode }) {
  if (!emailVerificationEnabled) return true;
  return verificationEmail === email.trim().toLowerCase() && /^\d{6}$/.test(verificationCode.trim());
}

export function getRegistrationVerificationPayload({ emailVerificationEnabled, turnstileToken, verificationCode }) {
  return emailVerificationEnabled
    ? { turnstileToken: '', verificationCode }
    : { turnstileToken, verificationCode: '' };
}
