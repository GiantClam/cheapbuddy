export const whisperXCapabilities = {
  alignment: { module: { name: '@hypit/whisperx', version: '1' }, name: 'whisperx-alignment' },
};

export const speechEvidenceTypes = {
  alignedTranscript: { module: { name: '@hypit/speech-evidence', version: '1' }, name: 'AlignedTranscriptEvidence' },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseLanguage(value) {
  assert(typeof value === 'string' && /^[a-z]{2,3}$/u.test(value) && value !== 'und',
    'WhisperX language must be an explicit lowercase two- or three-letter language code');
  return value;
}

export function verifyWhisperXAlignmentRequest(value) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'WhisperX alignment request must be an object');
  const request = value;
  assert(request.audio?.kind === 'blob' && request.audio.mediaType === 'audio/wav'
    && Number.isSafeInteger(request.sampleFrames) && request.sampleFrames > 0,
  'WhisperX alignment request is invalid');
  parseLanguage(request.language);
  return request;
}

function fourCc(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

export function assertWhisperXEvidenceWav(bytes, sampleFrames) {
  assert(bytes.byteLength >= 44 && fourCc(bytes, 0) === 'RIFF' && fourCc(bytes, 8) === 'WAVE', 'WhisperX input is not a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format;
  let dataBytes;
  while (offset + 8 <= bytes.byteLength) {
    const name = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    assert(body + size <= bytes.byteLength, 'WhisperX WAV has a truncated chunk');
    if (name === 'fmt ') {
      assert(size >= 16, 'WhisperX WAV fmt chunk is invalid');
      format = {
        codec: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (name === 'data') dataBytes = size;
    offset = body + size + (size % 2);
  }
  assert(format?.codec === 1 && format.channels === 1 && format.sampleRate === 16_000 && format.bits === 16,
    'WhisperX input must be 16 kHz mono PCM s16 WAV');
  assert(dataBytes === sampleFrames * 2, 'WhisperX input sample count differs from its contract');
}

function sampleWindow(startSec, endSec, sampleFrames) {
  if (typeof startSec !== 'number' || !Number.isFinite(startSec) || typeof endSec !== 'number'
    || !Number.isFinite(endSec) || startSec < 0 || endSec < startSec) return {};
  const startSample = Math.round(startSec * 16_000);
  const endSampleExclusive = Math.round(endSec * 16_000);
  if (!Number.isSafeInteger(startSample) || !Number.isSafeInteger(endSampleExclusive)
    || startSample > sampleFrames || endSampleExclusive > sampleFrames) return {};
  return { startSample, endSampleExclusive };
}

function words(value, sampleFrames) {
  assert(Array.isArray(value), 'WhisperX response has no Word array');
  return value.flatMap((raw) => {
    assert(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'WhisperX response Word is invalid');
    const text = typeof raw.text === 'string' ? raw.text.trim() : typeof raw.word === 'string' ? raw.word.trim() : '';
    if (!text) return [];
    const window = sampleWindow(raw.start, raw.end, sampleFrames);
    const score = typeof raw.score === 'number' && raw.score >= 0 && raw.score <= 1 ? { score: raw.score } : {};
    return [{ text, ...window, ...score }];
  });
}

export function interpretWhisperXTranscript(response, sampleFrames) {
  assert(Number.isSafeInteger(sampleFrames) && sampleFrames > 0, 'WhisperX sample count must be positive');
  if (Array.isArray(response.segments)) {
    const passages = response.segments.map((raw) => ({
      ...sampleWindow(raw.start, raw.end, sampleFrames),
      words: raw.words === undefined ? [] : words(raw.words, sampleFrames),
      chars: [],
    }));
    if (passages.some((passage) => passage.words.length > 0) || response.words === undefined) return passages;
  }
  if (response.words !== undefined) {
    const aligned = words(response.words, sampleFrames);
    const first = aligned.find((word) => word.startSample !== undefined);
    const last = [...aligned].reverse().find((word) => word.endSampleExclusive !== undefined);
    return [{
      ...(first?.startSample === undefined ? {} : { startSample: first.startSample }),
      ...(last?.endSampleExclusive === undefined ? {} : { endSampleExclusive: last.endSampleExclusive }),
      words: aligned,
      chars: [],
    }];
  }
  throw new Error('WhisperX response has no Segment or Word array');
}

export function sealAlignedTranscriptEvidence(value) {
  return structuredClone(value);
}
