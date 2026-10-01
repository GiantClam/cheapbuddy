# Cloudflare balance email delivery

Sub2API remains responsible for deciding when a user's wallet balance crosses
the configured threshold and for recording notification delivery keys. Only the
`balance.low` event is sent through the Cloudflare Worker. The Worker sends the
message with its `NOTICE_EMAIL` binding; all other email events continue to use
the existing SMTP configuration.

## Cloudflare Worker

The Worker requires both bindings in `cloudflare-worker/wrangler.toml`:

```toml
send_email = [{ name = "NOTICE_EMAIL" }]
```

Deploy the Worker, then set a secret used by the webhook verifier:

```powershell
npx wrangler secret put QUOTA_NOTIFY_TOKEN
npx wrangler deploy
```

`no-reply@cheapbuddy.cc` must be an allowed sender for the Email Sending
binding. Email Routing's inbound forwarding is separate and is not enough by
itself to authorize outbound delivery.

## Sub2API

Set these Railway environment variables on the Sub2API service:

```text
CLOUDFLARE_EMAIL_WEBHOOK_URL=https://cheapbuddy.cc/api/internal/quota-notify
CLOUDFLARE_EMAIL_WEBHOOK_SECRET=<the same value as QUOTA_NOTIFY_TOKEN>
```

When both variables are present, the balance-low notification uses the Worker;
when either is absent, the existing SMTP path is used. The secret is never
stored in the database or logged.

The existing settings still control behavior:

- `balance_low_notify_enabled` enables the global feature.
- `balance_low_notify_threshold` sets the default balance threshold.
- A user can override the threshold and recipient list in their profile.
- `balance_low_notify_recharge_url` is included in the rendered template.

The Worker rejects stale timestamps, invalid HMAC signatures, malformed
recipients, and duplicate `event_id` values. The Sub2API delivery key is used
as the event ID, so a retry after a network timeout does not send a duplicate
message.
