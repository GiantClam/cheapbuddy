import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Cloudflare Pages serves the payment result route through the app shell', async () => {
  const redirects = await readFile(new URL('../public/_redirects', import.meta.url), 'utf8');

  assert.match(redirects, /^\/payment\/result\s+\/\s+200\s*$/m);
});
