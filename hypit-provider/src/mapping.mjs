const moduleRef = (name) => ({ module: { name: `@hypit/${name}`, version: '1' } });

const imageMapping = {
  capabilityRef: { ...moduleRef('gpt-image'), name: 'gpt-image-2' },
  result: 'image',
  routes: [{ model: 'gpt-image-2' }],
  fields: {
    prompt: { as: 'value', field: 'prompt' },
    aspectRatio: { as: 'value', field: 'aspect_ratio' },
    resolution: { as: 'value', field: 'resolution', whenAbsent: '1K' },
    background: { as: 'value', field: 'background' },
    images: { as: 'itemObject', field: 'reference_images', urlKey: 'url', fieldKeys: {} },
  },
};

const seedanceMapping = {
  capabilityRef: { ...moduleRef('seedance'), name: 'seedance-2-mini' },
  result: 'video',
  routes: [{ model: 'doubao-seedance-2-0-mini-260615' }],
  fields: {
    prompt: { as: 'value', field: 'prompt' },
    referenceImage: { as: 'urlArray', field: 'reference_image_urls', resourceFields: ['personReference'] },
    referenceVideo: { as: 'urlArray', field: 'reference_videos', resourceFields: ['personReference'] },
    referenceAudio: { as: 'urlArray', field: 'reference_audios' },
    firstFrame: { as: 'url', field: 'first_frame', resourceFields: ['personReference'] },
    lastFrame: { as: 'url', field: 'last_frame', resourceFields: ['personReference'] },
    resolution: { as: 'value', field: 'resolution' },
    aspectRatio: { as: 'value', field: 'aspect_ratio' },
    duration: { as: 'value', field: 'seconds' },
    generateAudio: { as: 'value', field: 'generate_audio' },
    webSearch: { as: 'value', field: 'web_search' },
  },
};

const minimaxMapping = {
  capabilityRef: { ...moduleRef('minimax-h3'), name: 'minimax-h3' },
  result: 'video',
  routes: [{ model: 'MiniMax-H3' }],
  fields: {
    prompt: { as: 'value', field: 'prompt' },
    duration: { as: 'value', field: 'seconds' },
    resolution: { as: 'value', field: 'resolution', whenAbsent: '2k' },
    aspectRatio: { as: 'value', field: 'aspect_ratio' },
    referenceImage: { as: 'urlArray', field: 'reference_image_urls' },
    referenceVideo: { as: 'urlArray', field: 'reference_videos' },
    referenceAudio: { as: 'urlArray', field: 'reference_audios' },
    firstFrame: { as: 'url', field: 'first_frame' },
    lastFrame: { as: 'url', field: 'last_frame' },
  },
};

const mimoVoiceDesignMapping = {
  capabilityRef: { ...moduleRef('mimo-speech'), name: 'mimo-v2.5-tts-voicedesign' },
  result: 'audio',
  routes: [{ model: 'mimo-v2.5-tts-voicedesign' }],
  fields: {
    text: { as: 'value', field: 'input' },
    voiceDescription: { as: 'value', field: 'voice_description' },
  },
};

const fishVoiceDesignMapping = {
  capabilityRef: { ...moduleRef('fishaudio-speech'), name: 'voice-design-1' },
  result: 'audio',
  routes: [{ model: 'fishaudio/voice-design-1' }],
  fields: {
    text: { as: 'value', field: 'input' },
    voiceDescription: { as: 'value', field: 'voice_description' },
  },
};

const fishVoiceCloneMapping = {
  capabilityRef: { ...moduleRef('fishaudio-speech'), name: 'voice-clone' },
  result: 'audio',
  routes: [{ model: 'fishaudio/voice-clone' }],
  constants: { voice_description: 'reference' },
  fields: {
    text: { as: 'value', field: 'input' },
    voiceReference: { as: 'urlArray', field: 'reference_audio' },
  },
};

export const capabilityRoutes = [
  { capability: '@hypit/gpt-image@1#gpt-image-2', ...imageMapping, serviceModel: 'gpt-image-2' },
  { capability: '@hypit/seedance@1#seedance-2-mini', ...seedanceMapping, serviceModel: 'doubao-seedance-2-0-mini-260615' },
  { capability: '@hypit/minimax-h3@1#minimax-h3', ...minimaxMapping, serviceModel: 'MiniMax-H3' },
  { capability: '@hypit/mimo-speech@1#mimo-v2.5-tts-voicedesign', ...mimoVoiceDesignMapping, serviceModel: 'mimo-v2.5-tts-voicedesign' },
  { capability: '@hypit/fishaudio-speech@1#voice-design-1', ...fishVoiceDesignMapping, serviceModel: 'fishaudio/voice-design-1' },
  { capability: '@hypit/fishaudio-speech@1#voice-clone', ...fishVoiceCloneMapping, serviceModel: 'fishaudio/voice-clone' },
];

const routeByCapability = new Map(capabilityRoutes.map((route) => [route.capability, route]));
const maxReferenceBytes = 48 * 1024 * 1024;

export function serviceModelFor(capability) {
  const route = routeByCapability.get(capability);
  if (!route) throw new Error(`Unsupported Hypit capability: ${capability}`);
  return route.serviceModel;
}

export function routeFor(capabilityRef) {
  const key = `${capabilityRef?.module?.name}@${capabilityRef?.module?.version}#${capabilityRef?.name}`;
  const route = routeByCapability.get(key);
  if (!route) throw new Error(`Unsupported Hypit capability: ${key}`);
  return route;
}

export function dataUrl(bytes, mediaType) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (value.byteLength > maxReferenceBytes) throw new Error('Hypit reference resource is too large for CheapBuddy Data URL transport');
  if (typeof mediaType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/u.test(mediaType)) throw new Error('Invalid media type for Hypit reference resource');
  return `data:${mediaType};base64,${Buffer.from(value).toString('base64')}`;
}

export function mappingFor(route) {
  const { capabilityRef, result, routes, fields, constants } = route;
  return { capability: capabilityRef, result, routes, fields, ...(constants ? { constants } : {}) };
}

export function capabilityKey(capabilityRef) {
  return `${capabilityRef.module.name}@${capabilityRef.module.version}#${capabilityRef.name}`;
}
