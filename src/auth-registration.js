export function isEmailVerificationEnabled(settings) {
  return settings?.email_verify_enabled !== false;
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
