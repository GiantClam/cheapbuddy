import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('production static server serves blog routes without masking missing resources', { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cheapbuddy-static-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(directory, 'dist'));
  const appHtml = '<!doctype html><div id="root">App shell</div>';
  await writeFile(join(directory, 'dist', 'index.html'), appHtml, 'utf8');
  await writeFile(join(directory, 'dist', '404.html'), '<h1>Not found</h1>', 'utf8');

  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));

  child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/start.mjs', import.meta.url))], {
    cwd: directory,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let output = '';
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Static server exited before startup: ${code}`)));
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes(`listening on ${port}`)) resolve();
    });
  });

  for (const path of ['/', '/api-docs', '/comfyui', '/hypit', '/payment/result', '/blog', '/blog/', '/blog/one-balance-model-routing', '/blog/cheapbuddy-media-api-guide', '/blog/comfyui-cheapbuddy-workflows/']) {
    await t.test(`${path} serves the React app shell`, async () => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.equal(await response.text(), appHtml);
    });
  }

  for (const path of ['/blogger', '/blog.js', '/assets/missing.js']) {
    await t.test(`${path} remains a 404`, async () => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), '<h1>Not found</h1>');
    });
  }

  await t.test('API requests preserve their JSON error', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/settings`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await response.json(), { message: 'Sub2API API is not attached to this frontend service' });
  });
});
