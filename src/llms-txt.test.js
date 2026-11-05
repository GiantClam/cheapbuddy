import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { modelCatalog } from './models.js';
import { renderLlmsTxt } from '../scripts/generate-llms-txt.mjs';

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
  assert.match(text, /\[MiniMax-H3\]\(https:\/\/cheapbuddy\.cc\/api-docs\): id `MiniMax-H3`; MiniMax;/);
  assert.match(text, /\[grok-4\.7\]\(https:\/\/cheapbuddy\.cc\/#models\).*Not shown on the homepage shelf\./);

  const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  const blogUrls = [...sitemap.matchAll(/<loc>(https:\/\/cheapbuddy\.cc\/blog\/[^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(blogUrls.some((url) => url.endsWith('/blog/deepseek-harness-cheapbuddy')));
  for (const url of blogUrls) assert.ok(text.includes(url), url);

  const committed = await readFile(new URL('../public/llms.txt', import.meta.url), 'utf8');
  assert.equal(committed, text);
});
