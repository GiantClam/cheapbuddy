import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsageBilledTotal, hasTokenBreakdown, isUsageCostReported, mapUsageRecords, mergeUsageModels } from './usage.js';

test('merges text and NewAPI media usage by model', () => {
  const merged = mergeUsageModels(
    [{ model: 'gpt-5.6-terra', total_requests: 2, total_tokens: 120 }],
    [{ model: 'MiniMax-H3', requests: 3, actual_cost: 0.02 }, { model: 'gpt-image-2.5', requests: 1, actual_cost: 0.008 }],
  );

  assert.deepEqual(merged.map(({ model, total_requests, total_tokens, actual_cost, cost_reported }) => ({ model, total_requests, total_tokens, actual_cost, cost_reported })), [
    { model: 'MiniMax-H3', total_requests: 3, total_tokens: 0, actual_cost: 0.02, cost_reported: true },
    { model: 'gpt-5.6-terra', total_requests: 2, total_tokens: 120, actual_cost: 0, cost_reported: false },
    { model: 'gpt-image-2.5', total_requests: 1, total_tokens: 0, actual_cost: 0.008, cost_reported: true },
  ]);
  assert.equal(isUsageCostReported(merged), true);
  assert.equal(hasTokenBreakdown(merged[1]), false);
});

test('keeps the token breakdown and both cost fields when merging model usage', () => {
  const [merged] = mergeUsageModels([
    { model: 'gpt-6.1-terra', total_requests: 2, input_tokens: 900, output_tokens: 300, cache_read_tokens: 400, total_tokens: 1600, cost: 0.02, actual_cost: 0.0144 },
    { model: 'gpt-6.1-terra', total_requests: 1, input_tokens: 100, output_tokens: 88, total_tokens: 188, cost: 0.002, actual_cost: 0.00144 },
  ], []);

  assert.deepEqual({
    model: merged.model,
    total_requests: merged.total_requests,
    total_tokens: merged.total_tokens,
    input_tokens: merged.input_tokens,
    output_tokens: merged.output_tokens,
    cache_creation_tokens: merged.cache_creation_tokens,
    cache_read_tokens: merged.cache_read_tokens,
    cost_reported: merged.cost_reported,
  }, {
    model: 'gpt-6.1-terra',
    total_requests: 3,
    total_tokens: 1788,
    input_tokens: 1000,
    output_tokens: 388,
    cache_creation_tokens: 0,
    cache_read_tokens: 400,
    cost_reported: true,
  });
  assert.ok(Math.abs(merged.actual_cost - 0.01584) < 1e-9);
  assert.ok(Math.abs(merged.cost - 0.022) < 1e-9);
  assert.equal(hasTokenBreakdown(merged), true);
  assert.ok(Math.abs(getUsageBilledTotal([merged]) - 0.01584) < 1e-9);
});

test('maps per-request charge records for the billing ledger list', () => {
  const [record] = mapUsageRecords([
    {
      id: 41, created_at: '2026-11-05T06:12:00Z', model: 'kimi-k3.1-pro',
      input_tokens: 1200, output_tokens: 350, cache_read_tokens: 800,
      actual_cost: 0.004123, rate_multiplier: 0.625,
    },
  ]);

  assert.deepEqual(record, {
    id: 41,
    createdAt: '2026-11-05T06:12:00Z',
    model: 'kimi-k3.1-pro',
    inputTokens: 1200,
    outputTokens: 350,
    cacheCreationTokens: 0,
    cacheReadTokens: 800,
    totalTokens: 2350,
    actualCost: 0.004123,
    rateMultiplier: 0.625,
  });
  assert.equal(mapUsageRecords([{ id: 42, rate_multiplier: 0 }])[0].rateMultiplier, null);
  assert.deepEqual(mapUsageRecords(null), []);
});
