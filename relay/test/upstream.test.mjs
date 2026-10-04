import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';

import { fetchWithTimeout } from '../src/upstream.mjs';

test('fetchWithTimeout preserves ordinary URLs', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(request.url);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${port}/probe`, {}, 1000);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '/probe');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
