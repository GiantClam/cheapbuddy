import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from './api.js';
import { CLAUDE_API_KEY_GROUP_ID, OPENAI_API_KEY_GROUP_ID } from './key-groups.js';

function mockKeyApi(t, keys) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    const data = options.method === 'POST' ? { key: 'created-shared-key' } : { items: keys };
    return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
  });
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => 'account-token' } };
  t.after(() => { globalThis.window = oldWindow; });
  return calls;
}

test('reuses the existing OpenAI group key without moving it to Claude', async (t) => {
  const calls = mockKeyApi(t, [{ key: 'existing-shared-key', status: 'active', group_id: 2 }]);
  assert.equal(await api.getOrCreateApiKey(OPENAI_API_KEY_GROUP_ID), 'existing-shared-key');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/keys?page=1&page_size=20');
  assert.notEqual(calls[0].options.method, 'POST');
});

test('does not replace or widen an explicitly restricted existing group key', async (t) => {
  const existingKey = { key: 'restricted-key', status: 'active', group_id: 2, allowed_models: ['gpt-6-sol'] };
  const calls = mockKeyApi(t, [existingKey]);
  assert.equal(await api.getOrCreateApiKey(OPENAI_API_KEY_GROUP_ID), 'restricted-key');
  assert.deepEqual(existingKey.allowed_models, ['gpt-6-sol']);
  assert.equal(calls.length, 1);
});

test('does not create replacement credentials when only an inactive key exists', async (t) => {
  const calls = mockKeyApi(t, [{ key: 'disabled-key', status: 'disabled', group_id: 2 }]);
  assert.equal(await api.getOrCreateApiKey(OPENAI_API_KEY_GROUP_ID), 'disabled-key');
  assert.equal(calls.length, 1);
});

test('creates an OpenAI group key only when no matching key is available', async (t) => {
  const calls = mockKeyApi(t, []);
  assert.equal(await api.getOrCreateApiKey(OPENAI_API_KEY_GROUP_ID), 'created-shared-key');
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'CheapBuddy WorkBuddy', group_id: OPENAI_API_KEY_GROUP_ID });
});

test('selects an existing Claude group key even when an OpenAI key is also present', async (t) => {
  const calls = mockKeyApi(t, [
    { key: 'openai-key', status: 'active', group_id: OPENAI_API_KEY_GROUP_ID },
    { key: 'claude-key', status: 'active', group_id: CLAUDE_API_KEY_GROUP_ID },
  ]);
  assert.equal(await api.getOrCreateApiKey(CLAUDE_API_KEY_GROUP_ID), 'claude-key');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].options.method, 'POST');
});

test('creates a Claude group key for a user who has no matching key', async (t) => {
  const calls = mockKeyApi(t, [{ key: 'openai-key', status: 'active', group_id: OPENAI_API_KEY_GROUP_ID }]);
  assert.equal(await api.getOrCreateApiKey(CLAUDE_API_KEY_GROUP_ID), 'created-shared-key');
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'CheapBuddy Claude', group_id: CLAUDE_API_KEY_GROUP_ID });
});

test('rejects an invalid group before reading or creating credentials', async (t) => {
  const calls = mockKeyApi(t, []);
  await assert.rejects(api.getOrCreateApiKey(0), /API Key/);
  assert.equal(calls.length, 0);
});

test('does not create alternate credentials after an authorization failure', async (t) => {
  const calls = mockKeyApi(t, []);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ message: 'Access denied' }), { status: 403 });
  });
  await assert.rejects(api.getOrCreateApiKey(OPENAI_API_KEY_GROUP_ID), (error) => error.status === 403);
  assert.equal(calls.length, 1);
});

const sharedBaseUrl = 'https://api.example.test/v1';
const sharedModels = [{ id: 'gpt-6-sol' }, { id: 'claude-sonnet-5-5', channelId: 'claude' }];
const sharedGroup = { id: 9, platform: 'composite', status: 'active' };

function mockSharedKeyApi(t, { keys = [], groups = [sharedGroup], modelIds = sharedModels.map(({ id }) => id), respond } = {}) {
  const calls = [];
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => 'account-token' } };
  t.after(() => { globalThis.window = oldWindow; });
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url, options });
    const override = await respond?.(url, options);
    if (override) return override;
    const data = url === `${sharedBaseUrl}/models`
      ? modelIds.map((id) => ({ id }))
      : url.includes('/groups/available') ? groups
        : options.method === 'POST' ? { key: 'created-composite-key', status: 'active', group_id: sharedGroup.id }
          : { items: keys, total: keys.length };
    return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

test('checks both model families with the supplied key and does not request replacement credentials', async (t) => {
  const calls = mockSharedKeyApi(t);
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: `${sharedBaseUrl}/`, models: sharedModels, apiKey: 'current-key' }), 'current-key');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${sharedBaseUrl}/models`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer current-key');
  assert.notEqual(calls[0].options.method, 'POST');
});

test('returns an existing shared key for display before checking selected model access', async (t) => {
  const calls = mockSharedKeyApi(t, {
    keys: [{ key: 'shared-key', status: 'active', group_id: 9, group: sharedGroup }],
    modelIds: ['gpt-6-sol'],
  });
  const key = await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, validateModels: false });
  assert.equal(key, 'shared-key');
  assert.deepEqual(calls.map(({ url }) => url), ['/api/v1/keys?page=1&page_size=20']);
  await assert.rejects(
    api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, apiKey: key }),
    (error) => error.code === 'API_KEY_MODELS_UNAVAILABLE',
  );
  assert.equal(calls.at(-1).url, `${sharedBaseUrl}/models`);
});

test('does not contact unavailable model catalogs when only reading a shared key', async (t) => {
  for (const failure of [401, 403, 'network', 'invalid']) {
    await t.test(String(failure), async (subtest) => {
      const calls = mockSharedKeyApi(subtest, {
        keys: [{ key: 'shared-key', status: 'active', group_id: 9, group: sharedGroup }],
        respond: (url) => {
          if (url !== `${sharedBaseUrl}/models`) return undefined;
          if (failure === 'network') throw new TypeError('network unavailable');
          if (failure === 'invalid') return new Response('null');
          return new Response(JSON.stringify({ message: 'Catalog unavailable' }), { status: failure });
        },
      });
      assert.equal(await api.getOrCreateSharedApiKey({
        baseUrl: sharedBaseUrl, models: sharedModels, validateModels: false,
      }), 'shared-key');
      assert.deepEqual(calls.map(({ url }) => url), ['/api/v1/keys?page=1&page_size=20']);
    });
  }
});

test('creates one authorized shared key for display without model catalog access', async (t) => {
  const calls = mockSharedKeyApi(t, { modelIds: [] });
  assert.equal(await api.getOrCreateSharedApiKey({
    baseUrl: sharedBaseUrl, models: sharedModels, validateModels: false,
  }), 'created-composite-key');
  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/v1/keys?page=1&page_size=20', '/api/v1/groups/available', '/api/v1/keys',
  ]);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1);
});

test('reuses a supplied key for display without additional API requests', async (t) => {
  const calls = mockSharedKeyApi(t);
  assert.equal(await api.getOrCreateSharedApiKey({ apiKey: ' current-key ', validateModels: false }), 'current-key');
  assert.equal(calls.length, 0);
});

test('reuses an active composite key instead of separate OpenAI or Claude keys', async (t) => {
  const calls = mockSharedKeyApi(t, { keys: [
    { key: 'openai-key', status: 'active', group_id: 2, group: { platform: 'openai' } },
    { key: 'claude-key', status: 'active', group_id: 3, group: { platform: 'anthropic' } },
    { key: 'shared-key', status: 'active', group_id: 9, group: sharedGroup },
  ] });
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), 'shared-key');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer shared-key');
});

test('discovers an authorized composite group and creates only one shared key', async (t) => {
  const calls = mockSharedKeyApi(t, { groups: [
    { id: 2, platform: 'openai', status: 'active' },
    { id: 8, platform: 'composite', status: 'inactive' },
    sharedGroup,
  ] });
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), 'created-composite-key');
  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/v1/keys?page=1&page_size=20', '/api/v1/groups/available', '/api/v1/keys', `${sharedBaseUrl}/models`,
  ]);
  assert.deepEqual(JSON.parse(calls[2].options.body), { name: 'CheapBuddy Shared', group_id: 9 });
  assert.equal(calls[3].options.headers.Authorization, 'Bearer created-composite-key');
});

test('shares pending discovery and creation for concurrent calls from the same account', async (t) => {
  const calls = mockSharedKeyApi(t);
  const keys = await Promise.all(Array.from({ length: 3 }, () => api.getOrCreateSharedApiKey({
    baseUrl: sharedBaseUrl, models: sharedModels,
  })));
  assert.deepEqual(keys, Array(3).fill('created-composite-key'));
  assert.equal(calls.filter(({ url }) => url.includes('/keys?')).length, 1);
  assert.equal(calls.filter(({ url }) => url.includes('/groups/available')).length, 1);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1);
  assert.equal(calls.filter(({ url }) => url === `${sharedBaseUrl}/models`).length, 3);
});

test('independently checks each concurrent selection after sharing key creation', async (t) => {
  const calls = mockSharedKeyApi(t, { modelIds: ['gpt-6-sol'] });
  const results = await Promise.allSettled([
    api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: [sharedModels[0]] }),
    api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[0].value, 'created-composite-key');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'API_KEY_MODELS_UNAVAILABLE');
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1);
  assert.equal(calls.filter(({ url }) => url === `${sharedBaseUrl}/models`).length, 2);
});

test('clears failed pending discovery so later calls can retry', async (t) => {
  let denyGroups = true;
  const calls = mockSharedKeyApi(t, { respond: (url) => url.includes('/groups/available') && denyGroups
    ? new Response(JSON.stringify({ message: 'Access denied' }), { status: 403 }) : undefined });
  const results = await Promise.allSettled(Array.from({ length: 2 }, () => api.getOrCreateSharedApiKey({
    baseUrl: sharedBaseUrl, models: sharedModels,
  })));
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.status, 403);
  }
  assert.equal(calls.filter(({ url }) => url.includes('/keys?')).length, 1);
  assert.equal(calls.filter(({ url }) => url.includes('/groups/available')).length, 1);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 0);
  denyGroups = false;
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), 'created-composite-key');
  assert.equal(calls.filter(({ url }) => url.includes('/keys?')).length, 2);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1);
});

test('clears successful pending discovery and reads current credentials on the next call', async (t) => {
  let keyReads = 0;
  const calls = mockSharedKeyApi(t, { respond: (url) => {
    if (!url.includes('/keys?')) return undefined;
    keyReads += 1;
    return new Response(JSON.stringify({ data: { items: [{
      key: `current-key-${keyReads}`, status: 'active', group_id: 9, group: sharedGroup,
    }], total: 1 } }));
  } });
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), 'current-key-1');
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), 'current-key-2');
  assert.equal(calls.filter(({ url }) => url.includes('/keys?')).length, 2);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer current-key-2');
});

test('isolates pending discovery by account token and keeps that token through creation', async (t) => {
  let releaseLists;
  const listsReady = new Promise((resolve) => { releaseLists = resolve; });
  const calls = mockSharedKeyApi(t, { respond: async (url, options) => {
    if (url.includes('/keys?')) await listsReady;
    if (options.method !== 'POST') return undefined;
    const token = options.headers.Authorization.replace('Bearer ', '');
    return new Response(JSON.stringify({ data: { key: `key-for-${token}`, status: 'active', group_id: 9 } }));
  } });
  let token = 'account-a';
  globalThis.window.localStorage.getItem = () => token;
  const first = api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, validateModels: false });
  token = 'account-b';
  const second = api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels });
  releaseLists();
  assert.deepEqual(await Promise.all([first, second]), ['key-for-account-a', 'key-for-account-b']);
  for (const accountToken of ['account-a', 'account-b']) {
    const accountCalls = calls.filter(({ url, options }) => url.startsWith('/api/v1/')
      && options.headers.Authorization === `Bearer ${accountToken}`);
    assert.deepEqual(accountCalls.map(({ url }) => url), [
      '/api/v1/keys?page=1&page_size=20', '/api/v1/groups/available', '/api/v1/keys',
    ]);
  }
  assert.ok(calls.every(({ options }) => !Object.hasOwn(options, 'authToken')));
  const modelCalls = calls.filter(({ url }) => url === `${sharedBaseUrl}/models`);
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].options.headers.Authorization, 'Bearer key-for-account-b');
});

test('reuses a matching active key when only available-group metadata identifies it as composite', async (t) => {
  const calls = mockSharedKeyApi(t, { keys: [{ key: 'shared-key', status: 'active', group_id: 9 }] });
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), 'shared-key');
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 0);
});

test('refuses to create a provider-specific key when no shared group is authorized', async (t) => {
  const calls = mockSharedKeyApi(t, { groups: [{ id: 2, platform: 'openai', status: 'active' }] });
  await assert.rejects(api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), (error) => error.code === 'SHARED_API_KEY_GROUP_UNAVAILABLE');
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 0);
});

test('preserves account and group authorization when only reading a shared key', async (t) => {
  for (const failure of ['keys', 'groups', 'missing-group']) {
    await t.test(failure, async (subtest) => {
      const calls = mockSharedKeyApi(subtest, {
        groups: failure === 'missing-group' ? [{ id: 2, platform: 'openai', status: 'active' }] : [sharedGroup],
        respond: (url) => {
          if ((failure === 'keys' && url.includes('/keys?'))
            || (failure === 'groups' && url.includes('/groups/available'))) {
            return new Response(JSON.stringify({ message: 'Access denied' }), { status: 403 });
          }
          return undefined;
        },
      });
      await assert.rejects(api.getOrCreateSharedApiKey({
        baseUrl: sharedBaseUrl, models: sharedModels, validateModels: false,
      }), (error) => failure === 'missing-group' ? error.code === 'SHARED_API_KEY_GROUP_UNAVAILABLE' : error.status === 403);
      assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 0);
      assert.equal(calls.filter(({ url }) => url === `${sharedBaseUrl}/models`).length, 0);
    });
  }
});

test('reads every key page before deciding whether a composite key must be created', async (t) => {
  const calls = mockSharedKeyApi(t, { respond: (url) => {
    if (!url.includes('/keys?')) return undefined;
    const page = Number(new URL(url, 'https://console.example.test').searchParams.get('page'));
    const items = page === 1
      ? [{ key: 'openai-key', group_id: 2, status: 'active' }]
      : [{ key: 'later-shared-key', group_id: 9, status: 'active', group: sharedGroup }];
    return new Response(JSON.stringify({ data: { items, total: 2, page, page_size: 1 } }));
  } });
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), 'later-shared-key');
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /page=2/);
  assert.equal(calls[2].options.headers.Authorization, 'Bearer later-shared-key');
});

test('rejects the exact missing model and retains the existing key restrictions', async (t) => {
  const calls = mockSharedKeyApi(t, { modelIds: ['gpt-6-sol', 'claude-opus-5'] });
  await assert.rejects(
    api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, apiKey: 'restricted-key' }),
    (error) => error.code === 'API_KEY_MODELS_UNAVAILABLE'
      && error.message.includes('claude-sonnet-5-5')
      && error.metadata.missingModels.includes('claude-sonnet-5-5'),
  );
  assert.equal(calls.length, 1);
});

test('checks the public model IDs exported in client configurations', async (t) => {
  const calls = mockSharedKeyApi(t);
  const models = [{ id: 'gpt-6-sol', providerModelId: 'internal-openai-id' }, sharedModels[1]];
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models, apiKey: 'shared-key' }), 'shared-key');
  assert.equal(calls.length, 1);
});

test('accepts the public DeepSeek 1017 model when Relay publishes its exact ID', async (t) => {
  const calls = mockSharedKeyApi(t, { modelIds: ['deepseek-4.1-flash-1017'] });
  const models = [{ id: 'deepseek-4.1-flash-1017', providerModelId: 'deepseek-flash' }];
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models, apiKey: 'shared-key' }), 'shared-key');
  assert.equal(calls.length, 1);
});

test('rejects a provider-only catalog entry when the exported public model ID is not visible', async (t) => {
  const calls = mockSharedKeyApi(t, { modelIds: ['deepseek-flash', 'claude-sonnet-5-5'] });
  const models = [
    { id: 'deepseek/deepseek-v4.1-flash', providerModelId: 'deepseek-flash' },
    sharedModels[1],
  ];
  await assert.rejects(
    api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models, apiKey: 'shared-key' }),
    (error) => {
      assert.equal(error.code, 'API_KEY_MODELS_UNAVAILABLE');
      assert.deepEqual(error.metadata.missingModels, ['deepseek/deepseek-v4.1-flash']);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test('trims the public model ID and ignores provider metadata when checking access', async (t) => {
  const calls = mockSharedKeyApi(t);
  const models = [
    { id: '  gpt-6-sol  ' },
    { id: '  claude-sonnet-5-5  ', providerModelId: 'internal-claude-id' },
  ];
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models, apiKey: 'shared-key' }), 'shared-key');
  assert.equal(calls.length, 1);
});

test('rechecks cached credentials when the selected models expand', async (t) => {
  const calls = mockSharedKeyApi(t, { modelIds: ['gpt-6-sol'] });
  assert.equal(await api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: [sharedModels[0]], apiKey: 'cached-key' }), 'cached-key');
  await assert.rejects(
    api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, apiKey: 'cached-key' }),
    (error) => error.code === 'API_KEY_MODELS_UNAVAILABLE',
  );
  assert.equal(calls.length, 2);
});

test('does not switch composite keys to bypass an existing key model restriction', async (t) => {
  const calls = mockSharedKeyApi(t, { keys: [
    { key: 'restricted-key', group_id: 9, status: 'active', group: sharedGroup },
    { key: 'other-key', group_id: 9, status: 'active', group: sharedGroup },
  ], modelIds: ['gpt-6-sol'] });
  await assert.rejects(api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), (error) => error.code === 'API_KEY_MODELS_UNAVAILABLE');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer restricted-key');
});

test('preserves catalog authentication and network failures without creating replacement keys', async (t) => {
  for (const status of [401, 403, 'network']) {
    await t.test(String(status), async (subtest) => {
      const calls = mockSharedKeyApi(subtest, { respond: (url) => {
        if (url !== `${sharedBaseUrl}/models`) return undefined;
        if (status === 'network') throw new TypeError('network unavailable');
        return new Response(JSON.stringify({ error: { message: 'Key rejected', code: 'KEY_REJECTED' } }), { status });
      } });
      await assert.rejects(
        api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, apiKey: 'current-key' }),
        (error) => status === 'network' ? error.message === 'network unavailable' : error.status === status,
      );
      assert.equal(calls.length, 1);
    });
  }
});

test('does not create keys after group discovery is forbidden', async (t) => {
  const calls = mockSharedKeyApi(t, { respond: (url) => url.includes('/groups/available')
    ? new Response(JSON.stringify({ message: 'Access denied' }), { status: 403 }) : undefined });
  await assert.rejects(api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), (error) => error.status === 403);
  assert.equal(calls.length, 2);
});

test('does not create keys when reading existing credentials fails', async (t) => {
  const calls = mockSharedKeyApi(t, { respond: (url) => url.includes('/keys?')
    ? new Response(JSON.stringify({ message: 'Access denied' }), { status: 401 }) : undefined });
  await assert.rejects(api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), (error) => error.status === 401);
  assert.equal(calls.length, 1);
});

test('does not issue more credentials when a new shared key lacks selected models', async (t) => {
  const calls = mockSharedKeyApi(t, { groups: [sharedGroup, { id: 10, platform: 'composite', status: 'active' }], modelIds: ['gpt-6-sol'] });
  await assert.rejects(api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), (error) => error.code === 'API_KEY_MODELS_UNAVAILABLE');
  assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer created-composite-key');
});

test('does not create a replacement for a disabled, expired, or quota-exhausted shared key', async (t) => {
  const unavailableKeys = [
    { status: 'inactive' },
    { expires_at: '2020-01-01T00:00:00Z' },
    { quota: 1, quota_used: 1 },
    { group: { ...sharedGroup, status: 'disabled' } },
    { group: { ...sharedGroup, status: 'suspended' } },
    { group: { ...sharedGroup, id: 10 } },
    { group: { ...sharedGroup, id: 0 } },
  ];
  for (const validateModels of [true, false]) {
    for (const fields of unavailableKeys) {
      await t.test(JSON.stringify({ validateModels, ...fields }), async (subtest) => {
        const calls = mockSharedKeyApi(subtest, { keys: [{ key: 'limited-key', group_id: 9, group: sharedGroup, status: 'active', ...fields }] });
        await assert.rejects(api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, validateModels }), (error) => error.code === 'API_KEY_UNAVAILABLE');
        assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 0);
        assert.equal(calls.filter(({ url }) => url === `${sharedBaseUrl}/models`).length, 0);
      });
    }
  }
});

test('rejects an invalid model catalog without assuming access or creating another key', async (t) => {
  const calls = mockSharedKeyApi(t, { respond: (url) => url === `${sharedBaseUrl}/models`
    ? new Response(JSON.stringify({ models: 'unavailable' })) : undefined });
  await assert.rejects(
    api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, apiKey: 'current-key' }),
    (error) => error.code === 'INVALID_MODEL_CATALOG',
  );
  assert.equal(calls.length, 1);
});

test('rejects malformed group metadata and null catalogs with actionable errors', async (t) => {
  await t.test('groups', async (subtest) => {
    const calls = mockSharedKeyApi(subtest, { respond: (url) => url.includes('/groups/available')
      ? new Response(JSON.stringify({ data: { items: 'invalid' } })) : undefined });
    await assert.rejects(api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels }), (error) => error.code === 'SHARED_API_KEY_GROUP_UNAVAILABLE');
    assert.equal(calls.length, 2);
  });
  await t.test('catalog', async (subtest) => {
    const calls = mockSharedKeyApi(subtest, { respond: (url) => url === `${sharedBaseUrl}/models`
      ? new Response('null') : undefined });
    await assert.rejects(
      api.getOrCreateSharedApiKey({ baseUrl: sharedBaseUrl, models: sharedModels, apiKey: 'current-key' }),
      (error) => error.code === 'INVALID_MODEL_CATALOG',
    );
    assert.equal(calls.length, 1);
  });
});
