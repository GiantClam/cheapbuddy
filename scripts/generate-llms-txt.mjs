// Generates public/llms.txt from modelCatalog. Edit src/models.js, then run
// `node scripts/generate-llms-txt.mjs` (npm prebuild does this) and commit the file.
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localizeModel, modelCatalog } from '../src/models.js';

const SITE = 'https://cheapbuddy.cc';
const API_BASE = 'https://api.cheapbuddy.cc/v1';

export const llmsTxtPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/llms.txt');

const MODALITY_ORDER = ['text', 'image', 'video'];
const MODALITY_LABELS = { text: 'Text', image: 'Image', video: 'Video' };

const DOC_LINKS = [
  ['API docs', `${SITE}/api-docs`, 'Text, image, and video request shapes. Production base URL is https://api.cheapbuddy.cc/v1.'],
  ['Homepage', `${SITE}/`, 'Account, model shelf, and the config generator for WorkBuddy, Claude Code, OpenCode, and Codex.'],
  ['Model shelf', `${SITE}/#models`, 'Live model cards. A card shows either a vendor reference rate or the CheapBuddy customer rate; use the card for current numbers.'],
  ['Blog', `${SITE}/blog`, 'Client setup notes that point at the same base URL and model ids.'],
  ['DeepSeek Harness', `${SITE}/blog/deepseek-harness-cheapbuddy`, 'Add an OpenAI-compatible provider in DeepSeek Harness Settings, with /v1 on the base URL. CheapBuddy is not DeepSeek Harness.'],
  ['CLI base URLs', `${SITE}/blog/cli-base-url-templates`, 'Where Chat Completions, Responses, and Anthropic Messages base URLs should stop.'],
  ['Claude access', `${SITE}/blog/claude-stable-channel-guide`, 'Authorized Claude ids over Anthropic Messages or the OpenAI-compatible API.'],
  ['One balance', `${SITE}/blog/one-balance-model-routing`, 'Why one key and one USD balance can reach many authorized models.'],
  ['Media API', `${SITE}/blog/cheapbuddy-media-api-guide`, 'Image generation and asynchronous video download.'],
  ['ComfyUI workflows', `${SITE}/blog/comfyui-cheapbuddy-workflows`, 'Text, image, and video nodes inside a ComfyUI workflow.'],
];

const OPTIONAL_LINKS = [
  ['ComfyUI nodes', `${SITE}/comfyui`, 'Install page for the text, image, and video nodes.'],
  ['Hypit provider', `${SITE}/hypit`, 'Install @cheapbuddy/provider and generate MiniMax-H3 video in Hypit.'],
  ['Examples', 'https://github.com/GiantClam/cheapbuddy-examples', 'Sample clients for the public API.'],
];

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function modelPageUrl(model) {
  const path = model.seoPathEn || model.seoPath;
  if (typeof path === 'string' && path.startsWith('/')) return `${SITE}${path}`;
  if (model.modality === 'image' || model.modality === 'video') return `${SITE}/api-docs`;
  return `${SITE}/#models`;
}

function routeNote(model) {
  const endpoint = typeof model.endpointPath === 'string' && model.endpointPath.startsWith('/')
    ? `POST /v1${model.endpointPath}`
    : '';
  const protocols = Array.isArray(model.protocols) ? model.protocols : [];
  if (protocols.includes('anthropic')) {
    return `Anthropic Messages (${endpoint || 'POST /v1/messages'}) or OpenAI-compatible`;
  }
  if (protocols.includes('typesafe')) return endpoint ? `TypeSafe System One ${endpoint}` : 'TypeSafe System One';
  if (model.modality === 'image' || model.modality === 'video') return endpoint || `${model.modality} API`;
  return endpoint ? `OpenAI-compatible ${endpoint}` : 'OpenAI-compatible';
}

function linkItem(title, url, note) {
  return `- [${title}](${url}): ${note}`;
}

export function modelLlmsLine(model) {
  const localized = localizeModel(model, 'en');
  const vendor = oneLine(localized.vendor) || 'Unknown';
  const description = oneLine(localized.description);
  const hidden = model.showOnHomepage === false ? ' Not shown on the homepage shelf.' : '';
  return linkItem(
    model.id,
    modelPageUrl(model),
    `id \`${model.id}\`; ${vendor}; ${description}. ${routeNote(model)}.${hidden}`,
  );
}

function modalityLabel(modality) {
  if (MODALITY_LABELS[modality]) return MODALITY_LABELS[modality];
  const raw = oneLine(modality) || 'Other';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function groupModels(models) {
  const groups = new Map();
  for (const model of models) {
    const key = model.modality || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(model);
  }
  const keys = [
    ...MODALITY_ORDER.filter((key) => groups.has(key)),
    ...[...groups.keys()].filter((key) => !MODALITY_ORDER.includes(key)),
  ];
  return keys.map((key) => ({ label: modalityLabel(key), models: groups.get(key) }));
}

export function renderLlmsTxt(models = modelCatalog) {
  const lines = [
    '# CheapBuddy',
    '',
    `> OpenAI-compatible multi-model API gateway with one balance and one API key. Base URL: ${API_BASE}. Supports WorkBuddy, Claude Code, OpenCode, Codex, and other compatible clients.`,
    '',
    'Send the public model `id` (for example `deepseek-flash` or `claude-opus-5-5`), not the display name. OpenAI-compatible clients must keep `/v1` on `base_url` (`https://api.cheapbuddy.cc/v1`); the client appends `/chat/completions` or `/responses`. Claude models accept Anthropic Messages (`POST /v1/messages`) or that OpenAI-compatible surface. Prices on model cards are a vendor reference rate or the CheapBuddy customer rate, depending on the card. Read the live card for current rates. This file is not a price list.',
    '',
    'CheapBuddy is an independent gateway. It is not operated by DeepSeek, Anthropic, OpenAI, or other model vendors.',
    '',
    `The Models list is generated from the site catalog and includes all ${models.length} public ids. A key can call only the models its group authorizes. Check \`GET ${API_BASE}/models\`.`,
    '',
    '## Docs',
    '',
    ...DOC_LINKS.map(([title, url, note]) => linkItem(title, url, note)),
    '',
    '## Models',
    '',
  ];

  for (const group of groupModels(models)) {
    lines.push(`${group.label}:`, '');
    for (const model of group.models) lines.push(modelLlmsLine(model));
    lines.push('');
  }

  lines.push(
    '## Optional',
    '',
    ...OPTIONAL_LINKS.map(([title, url, note]) => linkItem(title, url, note)),
    '',
  );

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

export async function writeLlmsTxt(destination = llmsTxtPath, models = modelCatalog) {
  const body = renderLlmsTxt(models);
  await writeFile(destination, body, 'utf8');
  return destination;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const destination = await writeLlmsTxt();
  console.log(`Wrote ${destination}`);
}
