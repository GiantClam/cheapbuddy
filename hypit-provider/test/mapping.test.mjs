import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityRoutes, dataUrl, serviceModelFor } from '../src/mapping.mjs';
import { pricingRequestPath, pricingSummary } from '../src/pricing.mjs';

test('maps Hypit capability model names to CheapBuddy upstream model names', () => {
  assert.equal(serviceModelFor('@hypit/gpt-image@1#gpt-image-2'), 'gpt-image-2');
  assert.equal(serviceModelFor('@hypit/seedance@1#seedance-2-mini'), 'doubao-seedance-2-0-mini-260615');
  assert.equal(serviceModelFor('@hypit/minimax-h3@1#minimax-h3'), 'MiniMax-H3');
});

test('declares the MVP capability surface', () => {
  assert.deepEqual(capabilityRoutes.map((route) => route.capability), [
    '@hypit/gpt-image@1#gpt-image-2',
    '@hypit/seedance@1#seedance-2-mini',
    '@hypit/minimax-h3@1#minimax-h3',
    '@hypit/mimo-speech@1#mimo-v2.5-tts-voicedesign',
    '@hypit/fishaudio-speech@1#voice-design-1',
    '@hypit/fishaudio-speech@1#voice-clone',
  ]);
});

test('creates bounded data URLs for reference resources', () => {
  assert.equal(dataUrl(new Uint8Array([0, 1, 2]), 'image/png'), 'data:image/png;base64,AAEC');
  assert.throws(() => dataUrl(new Uint8Array(65 * 1024 * 1024), 'image/png'), /too large/);
});

test('builds an authenticated model-specific pricing query path', () => {
  assert.equal(pricingRequestPath('MiniMax-H3'), '/v1/pricing?model=MiniMax-H3');
  assert.equal(pricingRequestPath('vendor/model name'), '/v1/pricing?model=vendor%2Fmodel%20name');
  assert.throws(() => pricingRequestPath(''), /valid service model/);
});

test('summarizes published pricing without pretending to predict media usage', () => {
  assert.equal(
    pricingSummary({ group_ratio: { default: 1.2 }, cheapbuddy: { media_multiplier: 0.6 } }, 'MiniMax-H3'),
    'CheapBuddy/NewAPI current rate-card entry for MiniMax-H3; default group ratio 1.2; CheapBuddy media multiplier 0.6; the response includes original billing units; final debit uses actual successful usage',
  );
});
