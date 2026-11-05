import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelCatalog } from './models.js';
import { llmsTxtPath, renderLlmsTxt } from '../scripts/generate-llms-txt.mjs';
import { checkCommittedLlmsTxt, llmsTxtDrift } from '../scripts/check-llms-txt.mjs';

test('llms.txt is generated from modelCatalog and matches the committed file', async () => {
  const text = renderLlmsTxt(modelCatalog);
  assert.match(text, /^# CheapBuddy\n\n> OpenAI-compatible multi-model API gateway/);
  assert.match(text, /https:\/\/api\.cheapbuddy\.cc\/v1/);
  assert.match(text, new RegExp(`all ${modelCatalog.length} public ids`));
  assert.match(text, /not operated by DeepSeek, Anthropic, OpenAI/);
  assert.doesNotMatch(text, /CheapBuddy is the official/i);
  assert.equal(text.endsWith('\n'), true);

  const docsAt = text.indexOf('\n## Docs\n');
  const modelsAt = text.indexOf('\n## Models\n');
  const optionalAt = text.indexOf('\n## Optional\n');
  assert.ok(docsAt > 0 && modelsAt > docsAt && optionalAt > modelsAt);

  const modelLines = text.split('\n').filter((line) => line.includes('id `'));
  assert.equal(modelLines.length, modelCatalog.length);
  for (const model of modelCatalog) {
    assert.ok(modelLines.some((line) => line.includes(`id \`${model.id}\``)), model.id);
  }

  assert.match(text, /\[deepseek-flash\]\(https:\/\/cheapbuddy\.cc\/#models\): id `deepseek-flash`; DeepSeek;/);
  assert.match(text, /\[deepseek-v4\.1-flash-1017\]\(https:\/\/cheapbuddy\.cc\/en\/model\/deepseek-v4-1-flash-1017\/\)/);
  assert.match(text, /\[claude-opus-5-5\]\(https:\/\/cheapbuddy\.cc\/en\/model\/claude-opus-5-5\/\)/);
  assert.match(text, /\[gpt-image-2\.5\]\(https:\/\/cheapbuddy\.cc\/api-docs\): id `gpt-image-2\.5`; OpenAI;/);
  assert.match(text, /\[gpt-image-2\.6\]\(https:\/\/cheapbuddy\.cc\/en\/model\/gpt-image-2-6\/\): id `gpt-image-2\.6`/);
  assert.match(text, /\[MiniMax-H3\]\(https:\/\/cheapbuddy\.cc\/api-docs\): id `MiniMax-H3`; MiniMax;/);
  assert.match(text, /\[grok-4\.7\]\(https:\/\/cheapbuddy\.cc\/#models\).*Not shown on the homepage shelf\./);

  const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const blogUrls = [...sitemap.matchAll(/<loc>(https:\/\/cheapbuddy\.cc\/blog\/[^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(blogUrls.some((url) => url.endsWith('/blog/deepseek-harness-cheapbuddy')));
  for (const url of blogUrls) assert.ok(text.includes(url), url);

  const committed = await readFile(llmsTxtPath, 'utf8');
  assert.equal(committed, text);
  assert.equal(llmsTxtDrift(committed), null);
});

test('llms.txt gate fails when modelCatalog changes without regenerating', () => {
  const withoutFlash = modelCatalog.filter((model) => model.id !== 'deepseek-flash');
  const drift = llmsTxtDrift(renderLlmsTxt(modelCatalog), withoutFlash);
  assert.match(drift, /public\/llms\.txt is stale relative to src\/models\.js modelCatalog/);
  assert.match(drift, /npm run generate:llms/);
  assert.equal(llmsTxtDrift(`${renderLlmsTxt(modelCatalog)}stale`), drift);
});

test('check-llms-txt accepts the committed file and rejects a stale copy', async () => {
  const fresh = await checkCommittedLlmsTxt(llmsTxtPath);
  assert.equal(fresh.status, 0);

  const directory = await mkdtemp(join(tmpdir(), 'cheapbuddy-llms-'));
  try {
    const stalePath = join(directory, 'llms.txt');
    await writeFile(stalePath, `${await readFile(llmsTxtPath, 'utf8')}stale`, 'utf8');
    const stale = await checkCommittedLlmsTxt(stalePath);
    assert.equal(stale.status, 1);
    assert.match(stale.message, /npm run generate:llms/);

    const missing = await checkCommittedLlmsTxt(join(directory, 'missing.txt'));
    assert.equal(missing.status, 1);
    assert.match(missing.message, /missing/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const script = fileURLToPath(new URL('../scripts/check-llms-txt.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});
