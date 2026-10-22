import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Node does not provide the Workers email runtime. Stub only that dependency;
// every request below executes the real Worker fetch handler.
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:email') {
      return { url: 'data:text/javascript,export class EmailMessage {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { default: worker } = await import('./index.js');

const relayOrigin = 'https://relay-prod-production-df4a.up.railway.app';
const accountOrigin = 'https://sub2api-production-493f.up.railway.app';
const publicOrigins = ['https://cheapbuddy.cc', 'https://www.cheapbuddy.cc', 'https://api.cheapbuddy.cc'];

test('every public v1 model, quote, and media route reaches the same Relay', async (t) => {
  const paths = [
    '/v1/models',
    '/v1/models/MiniMax-H3',
    '/v1/pricing?model=MiniMax-H3&seconds=4',
    '/v1/pricing?model=gpt-image-2.5',
    '/v1/videos/video-example/download-url?format=json',
  ];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (request) => {
    calls.push(request.url);
    return Response.json({ object: 'list', data: [] });
  });
  for (const origin of publicOrigins) {
    for (const path of paths) {
      await worker.fetch(new Request(origin + path), {});
      assert.equal(calls.at(-1), relayOrigin + path, `${origin}${path}`);
    }
  }
});

test('inference preserves request method, raw body, query and protocol headers', async (t) => {
  const body = '{ "model": "claude-sonnet-5-5", "stream": true, "messages": [] }';
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (request) => {
    forwarded = {
      url: request.url,
      method: request.method,
      body: await request.text(),
      authorization: request.headers.get('Authorization'),
      apiKey: request.headers.get('x-api-key'),
      version: request.headers.get('anthropic-version'),
      contentType: request.headers.get('Content-Type'),
      idempotencyKey: request.headers.get('Idempotency-Key'),
    };
    return Response.json({ content: [] });
  });
  await worker.fetch(new Request('https://cheapbuddy.cc/v1/messages?beta=tools', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-user-credential',
      'x-api-key': 'test-anthropic-credential',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'routing-regression-example',
    },
    body,
  }), {});
  assert.deepEqual(forwarded, {
    url: `${relayOrigin}/v1/messages?beta=tools`,
    method: 'POST', body,
    authorization: 'Bearer test-user-credential',
    apiKey: 'test-anthropic-credential',
    version: '2023-06-01',
    contentType: 'application/json',
    idempotencyKey: 'routing-regression-example',
  });
});

test('video multipart uploads retain their boundary and raw file bytes', async (t) => {
  const boundary = 'cheapbuddy-regression-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nMiniMax-H3\r\n--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.from([137, 80, 78, 71, 0, 255]),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  t.mock.method(globalThis, 'fetch', async (request) => {
    assert.equal(request.url, `${relayOrigin}/v1/videos`);
    assert.equal(request.headers.get('Content-Type'), `multipart/form-data; boundary=${boundary}`);
    assert.deepEqual(Buffer.from(await request.arrayBuffer()), body);
    return Response.json({ id: 'video-example' });
  });
  await worker.fetch(new Request('https://www.cheapbuddy.cc/v1/videos', {
    method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body,
  }), {});
});

test('SSE starts before the upstream stream completes and keeps each chunk', { timeout: 2000 }, async (t) => {
  const encoder = new TextEncoder();
  const first = 'event: response.created\ndata: {"id":"example"}\n\n';
  const last = 'event: response.completed\ndata: {"status":"completed"}\n\n';
  let streamController;
  const body = new ReadableStream({
    start(controller) { streamController = controller; controller.enqueue(encoder.encode(first)); },
  });
  t.mock.method(globalThis, 'fetch', async (request) => {
    assert.equal(request.url, `${relayOrigin}/v1/responses`);
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'X-Request-ID': 'stream-example' } });
  });
  const response = await worker.fetch(new Request('https://cheapbuddy.cc/v1/responses', {
    method: 'POST', body: '{"stream":true}',
  }), {});
  assert.equal(response.headers.get('X-Request-ID'), 'stream-example');
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), first);
  streamController.enqueue(encoder.encode(last));
  streamController.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), last);
  assert.equal((await reader.read()).done, true);
});

test('account login, API keys and payment requests remain on Sub2API', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (request) => {
    calls.push(request.url);
    return Response.json({ code: 0, data: {} });
  });
  for (const path of ['/api/v1/auth/login', '/api/v1/keys?page=2&page_size=20', '/api/v1/payment/orders']) {
    await worker.fetch(new Request(`https://cheapbuddy.cc${path}`), {});
    assert.equal(calls.at(-1), accountOrigin + path);
  }
});

test('admin blocking stays local and quota email remains an explicit signed endpoint', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected upstream request'); });
  for (const path of ['/api/v1/admin', '/api/v1/admin/accounts']) {
    assert.equal((await worker.fetch(new Request(`https://cheapbuddy.cc${path}`), {})).status, 404);
  }
  assert.equal((await worker.fetch(new Request('https://cheapbuddy.cc/v1/internal/quota-notify', { method: 'POST' }), {})).status, 503);
  assert.equal(upstream.mock.callCount(), 0);
});

test('upstream 503 errors and request IDs survive CORS normalization', async (t) => {
  const body = '{"error":{"type":"server_error","message":"Service temporarily unavailable"}}';
  t.mock.method(globalThis, 'fetch', async () => new Response(body, {
    status: 503,
    headers: {
      'Content-Type': 'application/json', 'X-Request-ID': 'failure-example',
      'Access-Control-Allow-Origin': 'https://cheapbuddy.cc, https://cheapbuddy.cc',
      'Access-Control-Allow-Credentials': 'true, true',
    },
  }));
  const response = await worker.fetch(new Request('https://cheapbuddy.cc/v1/chat/completions', {
    headers: { Origin: 'https://cheapbuddy.cc' },
  }), {});
  assert.equal(response.status, 503);
  assert.equal(await response.text(), body);
  assert.equal(response.headers.get('X-Request-ID'), 'failure-example');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://cheapbuddy.cc');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('preflight keeps the website CORS policy without contacting an upstream', async (t) => {
  const upstream = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected upstream request'); });
  const response = await worker.fetch(new Request('https://www.cheapbuddy.cc/v1/models', {
    method: 'OPTIONS', headers: { Origin: 'https://www.cheapbuddy.cc' },
  }), {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://www.cheapbuddy.cc');
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal(upstream.mock.callCount(), 0);
});
