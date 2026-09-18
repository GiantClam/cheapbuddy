import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAdminAccess } from './api.js';

function mockWindow(value = 'fixture') {
  globalThis.window = {
    localStorage: {
      getItem: (key) => key === 'cheapbuddy_auth_token' ? value : null,
    },
  };
}

test('verifyAdminAccess calls the native Sub2API admin endpoint', async () => {
  mockWindow();
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ data: { items: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    await verifyAdminAccess();
    assert.equal(request.url, '/api/v1/admin/users?page=1&page_size=1');
    assert.equal(request.options.method, undefined);
    assert.equal(request.options.headers.Authorization, 'Bearer fixture');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
