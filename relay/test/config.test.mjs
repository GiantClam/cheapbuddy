import test from 'node:test';
import assert from 'node:assert/strict';
import { extractModel, isMediaPath, isTextPath, loadConfig } from '../src/config.mjs';

const baseEnv = {
  DATABASE_URL: 'postgres://relay:test@localhost/relay',
  SUB2API_INTERNAL_URL: 'http://sub2api.internal',
  NEWAPI_INTERNAL_URL: 'http://newapi.internal',
  SUB2API_RELAY_SERVICE_TOKEN: 'relay-token',
  NEWAPI_ADMIN_TOKEN: 'newapi-admin',
  RELAY_TOKEN_ENCRYPTION_KEY: 'encryption-key',
  RELAY_VERIFIED_MODELS: 'gpt-image-2,seedance,suno',
  RELAY_RESERVATION_QUOTA_BY_MODEL: '{"gpt-image-2":100,"seedance":1000,"suno":100}',
};

test('loadConfig requires explicit verified model reservations', () => {
  const config = loadConfig(baseEnv);
  assert.deepEqual(config.reservationQuotaByModel, { 'gpt-image-2': 100, seedance: 1000, suno: 100 });
  assert.throws(() => loadConfig({ ...baseEnv, RELAY_VERIFIED_MODELS: '' }), /RELAY_VERIFIED_MODELS/);
  assert.throws(() => loadConfig({ ...baseEnv, RELAY_RESERVATION_QUOTA_BY_MODEL: '{"x":-1}' }), /non-negative integer/);
});

test('routes media tasks explicitly and extracts JSON or multipart model', () => {
  assert.equal(isTextPath('/v1/chat/completions', ['/v1/chat/completions']), true);
  assert.equal(isMediaPath('/v1/videos/abc', ['/v1/videos']), true);
  assert.equal(isMediaPath('/v1/audio/speech', ['/v1/audio/speech']), true);
  assert.equal(isMediaPath('/v1/audio/transcriptions', ['/v1/audio/transcriptions']), true);
  assert.equal(isMediaPath('/api/user/', []), false);
  assert.equal(extractModel({ model: ' seedance ' }), 'seedance');
});

test('allows relay media staging uploads and public media reads', () => {
  const mediaPaths = ['/v1/media'];
  assert.equal(isMediaPath('/v1/media', mediaPaths), true);
  assert.equal(isMediaPath('/v1/media/media-token', mediaPaths), true);
});
