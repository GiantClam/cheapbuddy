import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWhisperXEvidenceWav, interpretWhisperXTranscript, verifyWhisperXAlignmentRequest, whisperXCapabilities } from '../src/whisperx.mjs';

function wav(sampleFrames) {
  const bytes = new Uint8Array(44 + sampleFrames * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset, value) => bytes.set(value.split('').map((char) => char.charCodeAt(0)), offset);
  write(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, sampleFrames * 2, true);
  return bytes;
}

test('validates the provider-neutral WhisperX WAV contract', () => {
  const bytes = wav(16_000);
  assertWhisperXEvidenceWav(bytes, 16_000);
  const request = verifyWhisperXAlignmentRequest({
    audio: { kind: 'blob', mediaType: 'audio/wav', size: bytes.byteLength, resource: 'audio-1' },
    sampleFrames: 16_000,
    language: 'zh',
  });
  assert.equal(request.language, 'zh');
  assert.equal(whisperXCapabilities.alignment.name, 'whisperx-alignment');
});

test('converts WhisperX segments into sample-based evidence', () => {
  const passages = interpretWhisperXTranscript({
    segments: [{ start: 0.25, end: 1.5, words: [{ word: 'hello', start: 0.25, end: 0.5, score: 0.9 }] }],
  }, 32_000);
  assert.deepEqual(passages[0].words[0], { text: 'hello', startSample: 4_000, endSampleExclusive: 8_000, score: 0.9 });
});
