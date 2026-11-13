# Resend campaign notifications

The campaign sender is intentionally kept out of the browser bundle. It reads users from the authenticated Sub2API admin API, removes invalid addresses, duplicate addresses, blacklisted domains, and banned accounts, then sends through Resend in batches of 100.

Required environment variables:

```text
SUB2API_ADMIN_API_BASE_URL=https://<admin-api-host>/api/v1
SUB2API_ADMIN_TOKEN=<server-side-admin-token>
RESEND_API_KEY=<server-side-resend-key>
RESEND_FROM_EMAIL=CheapBuddy <no-reply@cheapbuddy.cc>
EMAIL_DOMAIN_BLACKLIST=example.invalid,disposable.test
```

Preview the selected recipients without sending:

```powershell
node scripts/send-resend-campaign.mjs
```

Send after reviewing the preview:

```powershell
node scripts/send-resend-campaign.mjs --send
```

The script refuses to send if the admin API URL, admin token, or explicit email-domain blacklist is missing. Keep all three secrets server-side; never put them in Vite environment variables or the frontend bundle.
