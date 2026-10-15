import process from 'node:process';

const DEFAULT_TEXT_PATHS = [
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
  '/v1/models',
];

const DEFAULT_MEDIA_PATHS = [
  '/v1/images/generations',
  '/v1/images/edits',
  '/v1/images/variations',
  '/v1/images/tasks',
  '/v1/video/generations',
  '/v1/audio/speech',
  '/v1/audio/transcriptions',
  '/v1/audio/translations',
  '/v1/videos',
  '/v1/media',
  '/suno/submit/music',
  '/suno/submit/lyrics',
  '/suno/fetch',
];

const csv = (value, fallback) => {
  const values = String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return values.length ? values : fallback;
};

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const required = (env, name) => {
  const value = String(env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const jsonObject = (value, name) => {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? ''));
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(`${name} must be a JSON object`);
  return Object.fromEntries(Object.entries(parsed).map(([key, amount]) => {
    const number = Number(amount);
    if (!Number.isInteger(number) || number < 0) throw new Error(`${name}.${key} must be a non-negative integer`);
    return [key.trim(), number];
  }));
};

export function loadConfig(env = process.env) {
  const config = {
    port: positiveInt(env.PORT, 8080),
    databaseUrl: required(env, 'DATABASE_URL'),
    sub2apiUrl: required(env, 'SUB2API_INTERNAL_URL').replace(/\/$/, ''),
    newapiUrl: required(env, 'NEWAPI_INTERNAL_URL').replace(/\/$/, ''),
    relayServiceToken: required(env, 'SUB2API_RELAY_SERVICE_TOKEN'),
    newapiAdminToken: required(env, 'NEWAPI_ADMIN_TOKEN'),
    tokenEncryptionKey: required(env, 'RELAY_TOKEN_ENCRYPTION_KEY'),
    sub2apiTimeoutMs: positiveInt(env.SUB2API_TIMEOUT_MS, 10_000),
    newapiTimeoutMs: positiveInt(env.NEWAPI_TIMEOUT_MS, 30_000),
    reconciliationIntervalMs: positiveInt(env.RECONCILIATION_INTERVAL_MS, 60_000),
    maxBodyBytes: positiveInt(env.RELAY_MAX_BODY_BYTES, 64 * 1024 * 1024),
    allowedCorsOrigins: csv(env.RELAY_CORS_ORIGINS, []),
    textPaths: csv(env.RELAY_TEXT_PATHS, DEFAULT_TEXT_PATHS),
    mediaPaths: csv(env.RELAY_MEDIA_PATHS, DEFAULT_MEDIA_PATHS),
    verifiedModels: csv(env.RELAY_VERIFIED_MODELS, []),
    reservationQuotaByModel: jsonObject(required(env, 'RELAY_RESERVATION_QUOTA_BY_MODEL'), 'RELAY_RESERVATION_QUOTA_BY_MODEL'),
    newapiUserPath: env.NEWAPI_USER_PATH?.trim() || '/api/user/',
    newapiLoginPath: env.NEWAPI_LOGIN_PATH?.trim() || '/api/user/login',
    newapiLogSearchPath: env.NEWAPI_LOG_SEARCH_PATH?.trim() || '/api/log/search',
  };

  if (!config.verifiedModels.length) throw new Error('RELAY_VERIFIED_MODELS is required');
  return config;
}

export function isMediaPath(pathname, mediaPaths) {
  if (mediaPaths.includes(pathname)) return true;
  return (mediaPaths.includes('/v1/videos') && /^\/v1\/videos\/[^/]+(?:\/content)?$/.test(pathname))
    || (mediaPaths.includes('/v1/media') && /^\/v1\/media\/[^/]+$/.test(pathname))
    || (mediaPaths.includes('/v1/video/generations') && /^\/v1\/video\/generations\/[^/]+$/.test(pathname))
    || (mediaPaths.includes('/v1/images/tasks') && /^\/v1\/images\/tasks\/[^/]+$/.test(pathname))
    || (mediaPaths.includes('/suno/fetch') && /^\/suno\/fetch\/[^/]+$/.test(pathname));
}

export function isTextPath(pathname, textPaths) {
  return textPaths.includes(pathname);
}

export function extractModel(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  return typeof body.model === 'string' ? body.model.trim() : '';
}
