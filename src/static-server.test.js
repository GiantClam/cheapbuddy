import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('production static server serves model pages and preserves missing-resource 404s', { timeout: 15000 }, async (t) => {
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
  await cp(fileURLToPath(new URL('../public/model', import.meta.url)), join(directory, 'dist', 'model'), { recursive: true });
  await cp(fileURLToPath(new URL('../public/en/model', import.meta.url)), join(directory, 'dist', 'en', 'model'), { recursive: true });
  await writeFile(join(directory, 'dist', 'model-pages.css'), 'model styles', 'utf8');
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

  for (const path of ['/', '/api-docs', '/comfyui', '/hypit', '/payment/result', '/model/deepseek-v4-1-flash-1017/', '/model/claude-opus-5-5/', '/en/model/deepseek-v4-1-flash-1017/', '/en/model/claude-opus-5-5/']) {
    await t.test(`${path} serves the React app shell`, async () => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      if (path.startsWith('/model/') || path.startsWith('/en/model/')) {
        const html = await response.text();
        assert.match(html, /<meta name="robots" content="index,follow/);
        assert.match(html, /application\/ld\+json/);
        assert.match(html, /<link rel="canonical"/);
        assert.doesNotMatch(html, /<div id="root">App shell/);
        for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
          assert.doesNotThrow(() => JSON.parse(json));
        }
        if (path.includes('claude-opus-5-5')) {
          assert.match(html, /data-multiplier="0\.3"/);
          assert.match(html, /30%/);
          assert.match(html, /70%/);
          assert.match(html, /\$1\.20/);
          assert.match(html, /\$6\.00/);
          assert.doesNotMatch(html, /3%|97%/);
        }
        if (path.includes('deepseek-v4-1-flash-1017')) {
          assert.match(html, /deepseek-flash/);
          assert.match(html, /deepseek-v4\.1-flash-1017/);
          assert.doesNotMatch(html, /pptoken|EcoPhase|aiberm|0\.8/);
        }
      } else {
        assert.equal(await response.text(), appHtml);
      }
    });
  }

  for (const path of ['/blog', '/blog/', '/blog/one-balance-model-routing', '/blogger', '/blog.js', '/assets/missing.js']) {
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
