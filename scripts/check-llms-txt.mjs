// Fails when committed public/llms.txt differs from modelCatalog. npm test runs this;
// prebuild still rewrites the file on deploy. Do not hand-edit public/llms.txt.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { llmsTxtPath, renderLlmsTxt } from './generate-llms-txt.mjs';
import { modelCatalog } from '../src/models.js';

export const LLMS_TXT_STALE_MESSAGE = [
  'public/llms.txt is stale relative to src/models.js modelCatalog.',
  'Run npm run generate:llms and commit public/llms.txt. Do not edit that file by hand.',
].join('\n');

export function llmsTxtDrift(committedText, models = modelCatalog) {
  if (committedText === renderLlmsTxt(models)) return null;
  return LLMS_TXT_STALE_MESSAGE;
}

export async function checkCommittedLlmsTxt(filePath = llmsTxtPath) {
  let committed;
  try {
    committed = await readFile(filePath, 'utf8');
  } catch {
    return { status: 1, message: `public/llms.txt is missing (${filePath}).\n${LLMS_TXT_STALE_MESSAGE}` };
  }
  const drift = llmsTxtDrift(committed);
  return drift ? { status: 1, message: drift } : { status: 0, message: '' };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const result = await checkCommittedLlmsTxt();
  if (result.status !== 0) {
    console.error(result.message);
    process.exit(result.status);
  }
}
