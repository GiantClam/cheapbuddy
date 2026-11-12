import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsageBilledTotal, getUsageEffectiveDiscount, getUsageReferenceCost, hasTokenBreakdown, isUsageCostReported, mapUsageRecords, mergeUsageModels } from './usage.js';
import { modelCatalog } from './models.js';

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
    referenceCost: null,
    effectiveDiscount: null,
    rateMultiplier: 0.625,
  });
  assert.equal(mapUsageRecords([{ id: 42, rate_multiplier: 0 }])[0].rateMultiplier, null);
  assert.deepEqual(mapUsageRecords(null), []);
});

test('calculates the final discount from the recorded reference cost, not the group multiplier', () => {
  const [record] = mapUsageRecords([{
    id: 43, model: 'glm-5.3-flash', actual_cost: 0.000071,
    reference_cost: 0.0001251, rate_multiplier: 1.1,
  }]);

  assert.equal(record.referenceCost, 0.0001251);
  assert.ok(Math.abs(record.effectiveDiscount - (0.000071 / 0.0001251)) < 1e-12);
  assert.equal(record.rateMultiplier, 1.1);
  const verifiedModel = modelCatalog.find((model) => model.id === 'claude-fable-5-2');
  assert.equal(getUsageReferenceCost({ reference_cost: '0.0001251' }, verifiedModel), 0.0001251);
  assert.equal(getUsageEffectiveDiscount(0.000071, 0.0001251), record.effectiveDiscount);
});

test('does not infer a discount when the official reference cost is unavailable', () => {
  const glm = modelCatalog.find((model) => model.id === 'glm-5.3');
  const [record] = mapUsageRecords([{ id: 44, model: 'glm-5.3', actual_cost: 0.001, account_stats_cost: 0.001, rate_multiplier: 1.1 }], [glm]);

  assert.equal(record.referenceCost, null);
  assert.equal(record.effectiveDiscount, null);
  assert.equal(getUsageEffectiveDiscount(0.001, null), null);
});

test('calculates a verified model reference cost from its official token rates', () => {
  const carbon = modelCatalog.find((model) => model.id === 'gemini-4-carbon');
  const reference = getUsageReferenceCost({ input_tokens: 1000, output_tokens: 500, cache_read_tokens: 2000 }, carbon);
  assert.equal(reference, 0.0072);
});
