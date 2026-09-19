import { canonicalize, credentialRef, defineEndpointPackage, wakeAfter } from '@hypit/hypit/endpoint-kit';
import { compileWireRequest, generationTypes, mappingSupportsRequest, sealGeneratedAudioSet, sealGeneratedImageSet, sealGeneratedVideoSet, selectWireModelForRequest } from '@hypit/hypit/generation';
import { capabilityRoutes, dataUrl, mappingFor, routeFor } from './mapping.mjs';
import { assertWhisperXEvidenceWav, interpretWhisperXTranscript, sealAlignedTranscriptEvidence, speechEvidenceTypes, verifyWhisperXAlignmentRequest, whisperXCapabilities } from './whisperx.mjs';

export const providerModule = { name: '@cheapbuddy/provider-hypit', version: '1' };
const transcriptionModel = 'victor-upmeet/whisperx';

function object(value, subject = 'response') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${subject} must be an object`);
  return value;
}

function text(value, subject = 'response text') {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${subject} must be a nonempty string`);
  return value;
}

function address(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('CheapBuddy baseUrl requires HTTPS or loopback HTTP');
  }
  return url.href.replace(/\/$/u, '');
}

function failure(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const error = value.error && typeof value.error === 'object' ? value.error : value;
  if (typeof error.code !== 'string' && typeof error.message !== 'string') return undefined;
  return {
    code: typeof error.code === 'string' ? error.code : 'CHEAPBUDDY_ERROR',
    message: typeof error.message === 'string' ? error.message.replace(/https?:\/\/\S+/giu, '[redacted-url]') : 'CheapBuddy request failed',
  };
}

function remoteId(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const key of ['id', 'task_id', 'request_id']) {
    if (typeof value[key] === 'string' || typeof value[key] === 'number') return String(value[key]);
  }
  for (const key of ['data', 'result']) {
    const id = remoteId(value[key]);
    if (id) return id;
  }
  return '';
}

function statusOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  return String(value.status ?? value.state ?? value.data?.status ?? value.data?.state ?? '').toLowerCase();
}

function defaultMediaType(prefix) {
  return prefix === 'image' ? 'image/png' : prefix === 'video' ? 'video/mp4' : 'audio/mpeg';
}

function flattenAssets(value, result = []) {
  if (value === null || value === undefined || result.length > 16) return result;
  if (typeof value === 'string' && (/^data:(image|video|audio)\//u.test(value) || /^https?:\/\//u.test(value))) {
    result.push({ url: value });
    return result;
  }
  if (typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (const item of value) flattenAssets(item, result);
    return result;
  }
  if (typeof value.b64_json === 'string') result.push({ b64: value.b64_json, mediaType: value.media_type });
  if (typeof value.url === 'string') result.push({ url: value.url });
  for (const key of ['data', 'output', 'images', 'videos', 'audios', 'artifacts']) {
    if (value[key] !== undefined) flattenAssets(value[key], result);
  }
  return result;
}

function decodeDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/us.exec(value);
  if (!match) throw new Error('CheapBuddy returned an invalid Data URL');
  return { bytes: Buffer.from(match[2], 'base64'), mediaType: match[1] };
}

function capabilitySupport(route, request) {
  return mappingSupportsRequest(mappingFor(route), request.constraints)
    ? { status: 'supported' }
    : { status: 'unsupported', reason: `CheapBuddy does not support all inputs for ${route.capability}` };
}

export function createCheapBuddyProvider(options) {
  const base = address(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const key = (credentials) => text(credentials.apiKey?.secret, 'CheapBuddy apiKey credential');

  async function responseBody(response) {
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('application/json')) return { kind: 'json', value: object(await response.json()) };
    return { kind: 'bytes', value: new Uint8Array(await response.arrayBuffer()), mediaType: type.split(';')[0].trim() || 'application/octet-stream' };
  }

  async function request(path, secret, init = {}) {
    const response = await fetcher(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secret}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(init.method === 'POST' ? 120_000 : 60_000),
    });
    const body = await responseBody(response);
    if (!response.ok) {
      const detail = body.kind === 'json' ? failure(body.value) : undefined;
      const requestId = response.headers.get('x-request-id');
      throw new Error(`CheapBuddy ${init.method ?? 'GET'} ${path} returned HTTP ${response.status}`
        + (requestId ? `; request=${requestId}` : '')
        + (detail ? `; ${detail.code}: ${detail.message}` : ''));
    }
    return body;
  }

  async function compile(route, context) {
    const authored = context.need.constraints;
    const mapping = mappingFor(route);
    const compiled = await compileWireRequest(mapping, authored, async (artifact) => {
      const bytes = await context.resources.get(artifact.resource);
      if (bytes === undefined) throw new Error(`Hypit resource ${artifact.resource} is unavailable`);
      return dataUrl(bytes, artifact.mediaType);
    });
    return { model: selectWireModelForRequest(mapping, authored), input: compiled.input };
  }

  async function collectAsset(spec, expectedPrefix) {
    if (spec.b64) {
      const bytes = Buffer.from(spec.b64, 'base64');
      return { bytes, mediaType: spec.mediaType ?? defaultMediaType(expectedPrefix) };
    }
    if (typeof spec.url !== 'string') throw new Error('CheapBuddy result has no asset URL or base64 data');
    if (spec.url.startsWith('data:')) return decodeDataUrl(spec.url);
    const assetUrl = new URL(spec.url);
    if (assetUrl.protocol !== 'https:' && !(assetUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(assetUrl.hostname))) {
      throw new Error('CheapBuddy result asset URL requires HTTPS or loopback HTTP');
    }
    const response = await fetcher(assetUrl, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok) throw new Error(`CheapBuddy asset download returned HTTP ${response.status}`);
    const mediaType = response.headers.get('content-type')?.split(';')[0].trim() ?? defaultMediaType(expectedPrefix);
    if (!mediaType.startsWith(`${expectedPrefix}/`)) throw new Error(`CheapBuddy returned ${mediaType}, expected ${expectedPrefix}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType };
  }

  async function sealAssets(payload, route, resources) {
    const candidates = flattenAssets(payload);
    if (candidates.length === 0) throw new Error(`CheapBuddy ${route.serviceModel} completed without media output`);
    const prefix = route.result;
    const artifacts = [];
    for (const candidate of candidates) {
      const asset = await collectAsset(candidate, prefix);
      artifacts.push(await resources.put(asset.bytes, asset.mediaType));
    }
    const value = route.result === 'image'
      ? sealGeneratedImageSet({ images: artifacts })
      : route.result === 'video'
        ? sealGeneratedVideoSet({ videos: artifacts })
        : sealGeneratedAudioSet({ audios: artifacts });
    return canonicalize(value);
  }

  async function submit(route, context) {
    const secret = key(context.credentials);
    const compiled = await compile(route, context);
    const input = object(compiled.input, `${route.capability} input`);
    const references = Object.keys(input).some((field) => field.startsWith('reference_') || field === 'first_frame' || field === 'last_frame');
    const path = route.result === 'image'
      ? references ? '/v1/images/edits' : '/v1/images/generations'
      : '/v1/videos';
    const response = await request(path, secret, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': context.operation },
      body: JSON.stringify({ model: route.serviceModel, ...input }),
    });
    if (response.kind === 'bytes') throw new Error('CheapBuddy returned binary data for an asynchronous generation');
    const id = remoteId(response.value);
    const assets = flattenAssets(response.value);
    if (!id && assets.length > 0) return { status: 'ready', handle: { inline: response.value }, receipt: { id: context.operation } };
    if (!id) throw new Error(`CheapBuddy ${route.serviceModel} response has no task id`);
    const handle = {
      id,
      path,
      pollPath: route.result === 'image' ? '/v1/images/tasks' : '/v1/videos',
      capability: route.capability,
    };
    await context.checkpoint?.({ handle, receipt: { id } });
    const status = statusOf(response.value);
    if (['succeeded', 'completed', 'success'].includes(status)) return { status: 'ready', handle, receipt: { id } };
    return { ...wakeAfter(handle, pollIntervalMs, Date.now(), { phase: status || 'submitted' }), receipt: { id } };
  }

  const asyncEndpoint = {
    async start(context) {
      const route = routeFor(context.need.capability);
      const supported = capabilitySupport(route, context.need);
      if (supported.status === 'unsupported') throw new Error(supported.reason);
      await context.reportProgress?.({ phase: `Submitting CheapBuddy ${route.serviceModel}` });
      return submit(route, context);
    },
    async poll(context) {
      const handle = object(context.handle, 'CheapBuddy task handle');
      const route = routeFor(context.need.capability);
      if (handle.capability !== route.capability) throw new Error('CheapBuddy task handle capability mismatch');
      const response = await request(`${handle.pollPath}/${encodeURIComponent(handle.id)}`, key(context.credentials));
      if (response.kind === 'bytes') throw new Error('CheapBuddy returned binary data while polling a task');
      const status = statusOf(response.value);
      if (['queued', 'pending', 'running', 'in_progress', 'processing'].includes(status)) {
        return wakeAfter(handle, pollIntervalMs, Date.now(), { phase: status });
      }
      const detail = failure(response.value);
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status) || detail) {
        return { status: 'failed', receipt: { id: handle.id }, failure: detail ?? { code: 'CHEAPBUDDY_TASK_FAILED', message: `CheapBuddy task ${handle.id} failed` } };
      }
      return { status: 'ready', handle: { ...handle, payload: response.value }, receipt: { id: handle.id } };
    },
    async collect(context) {
      const handle = object(context.handle, 'CheapBuddy task handle');
      const route = routeFor(context.need.capability);
      let payload = handle.payload ?? handle.inline;
      if (!payload && route.result === 'video') {
        const response = await request(`/v1/videos/${encodeURIComponent(text(handle.id))}/content`, key(context.credentials));
        if (response.kind === 'bytes') payload = { data: [{ b64_json: Buffer.from(response.value).toString('base64'), media_type: response.mediaType }] };
        else payload = response.value;
      }
      return { status: 'completed', result: { value: await sealAssets(payload, route, context.resources) } };
    },
  };

  const audioEndpoint = async (context) => {
    const route = routeFor(context.need.capability);
    const supported = capabilitySupport(route, context.need);
    if (supported.status === 'unsupported') throw new Error(supported.reason);
    const compiled = await compile(route, context);
    const response = await request('/v1/audio/speech', key(context.credentials), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': context.operation },
      body: JSON.stringify({ model: route.serviceModel, response_format: 'mp3', ...object(compiled.input, 'CheapBuddy audio input') }),
    });
    if (response.kind === 'bytes') {
      const artifact = await context.resources.put(response.value, response.mediaType.startsWith('audio/') ? response.mediaType : 'audio/mpeg');
      return { value: { kind: 'inline', value: canonicalize(sealGeneratedAudioSet({ audios: [artifact] })) } };
    }
    return { value: { kind: 'inline', value: await sealAssets(response.value, route, context.resources) } };
  };

  const whisperXEndpoint = async (context) => {
    const requestInfo = verifyWhisperXAlignmentRequest(context.need.constraints);
    const bytes = await context.resources.get(requestInfo.audio.resource);
    if (bytes === undefined || bytes.byteLength !== requestInfo.audio.size) throw new Error('WhisperX input Resource is unavailable or changed');
    assertWhisperXEvidenceWav(bytes, requestInfo.sampleFrames);
    const form = new FormData();
    form.append('model', transcriptionModel);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities', 'segment');
    form.append('timestamp_granularities', 'word');
    if (requestInfo.language) form.append('language', requestInfo.language);
    // The Relay reads the model before file parts so it can select NewAPI without buffering the upload.
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'input.wav');
    const response = await request('/v1/audio/transcriptions', key(context.credentials), { method: 'POST', body: form });
    if (response.kind !== 'json') throw new Error('CheapBuddy returned binary data for WhisperX');
    const evidence = sealAlignedTranscriptEvidence({ passages: interpretWhisperXTranscript(response.value, requestInfo.sampleFrames) });
    return { value: { kind: 'inline', value: canonicalize(evidence) } };
  };

  return defineEndpointPackage({
    module: providerModule,
    facet: 'gateway',
    instance: options.instance ?? 'cheapbuddy.media',
    pool: options.pool ?? 'cheapbuddy-media',
    credentials: { apiKey: options.apiKey ?? credentialRef('platform', 'cheapbuddy.api') },
    credentialInputs: { apiKey: { label: 'CheapBuddy API key' } },
    defaultConcurrency: options.defaultConcurrency ?? 2,
    actionLimits: { submit: { concurrency: 1 }, poll: { concurrency: 4 }, collect: { concurrency: 2 } },
    pricing: { kind: 'page', url: `${base}/v1/models` },
    capabilities: [
      ...capabilityRoutes.map((route) => ({
        capability: route.capabilityRef,
        returns: route.result === 'image' ? generationTypes.imageSet : route.result === 'video' ? generationTypes.videoSet : generationTypes.audioSet,
        lifecycle: route.result === 'audio' ? 'immediate' : 'asynchronous',
        ...(route.result === 'audio' ? { handler: audioEndpoint } : { endpoint: asyncEndpoint }),
        supports: (request) => capabilitySupport(route, request),
        capacity: route.result === 'audio' ? 'audio' : 'media',
      })),
      {
        capability: whisperXCapabilities.alignment,
        returns: speechEvidenceTypes.alignedTranscript,
        lifecycle: 'immediate',
        handler: whisperXEndpoint,
        capacity: 'transcription',
      },
    ],
  });
}
