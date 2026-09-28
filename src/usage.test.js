import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeUsageModels } from './usage.js';

test('merges text and NewAPI media usage by model', () => {
  assert.deepEqual(mergeUsageModels(
    [{ model: 'gpt-5.6-terra', total_requests: 2, total_tokens: 120 }],
    [{ model: 'MiniMax-H3', requests: 3, actual_cost: 0.02 }, { model: 'gpt-image-2.5', requests: 1, actual_cost: 0.008 }],
  ), [
    { model: 'MiniMax-H3', total_requests: 3, total_tokens: 0, actual_cost: 0.02 },
    { model: 'gpt-5.6-terra', total_requests: 2, total_tokens: 120, actual_cost: 0 },
    { model: 'gpt-image-2.5', total_requests: 1, total_tokens: 0, actual_cost: 0.008 },
  ]);
});
