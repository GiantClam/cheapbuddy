function usageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

const TOKEN_BREAKDOWN_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_tokens', 'cache_read_tokens'];
const REFERENCE_COST_FIELDS = ['official_cost', 'reference_cost', 'account_stats_cost'];

function emptyUsageModel(model) {
  return {
    model,
    total_requests: 0,
    total_tokens: 0,
    actual_cost: 0,
    cost: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    cost_reported: false,
  };
}

export function mergeUsageModels(textModels = [], mediaModels = []) {
  const merged = new Map();

  [...textModels, ...mediaModels].forEach((item) => {
    const model = String(item?.model || '').trim();
    if (!model) return;
    const current = merged.get(model) || emptyUsageModel(model);
    merged.set(model, {
      ...current,
      total_requests: current.total_requests + usageNumber(item.total_requests ?? item.requests),
      total_tokens: current.total_tokens + usageNumber(item.total_tokens),
      actual_cost: current.actual_cost + usageNumber(item.actual_cost),
      cost: current.cost + usageNumber(item.cost),
      input_tokens: current.input_tokens + usageNumber(item.input_tokens),
      output_tokens: current.output_tokens + usageNumber(item.output_tokens),
      cache_creation_tokens: current.cache_creation_tokens + usageNumber(item.cache_creation_tokens),
      cache_read_tokens: current.cache_read_tokens + usageNumber(item.cache_read_tokens),
      cost_reported: current.cost_reported || Object.prototype.hasOwnProperty.call(item || {}, 'actual_cost'),
    });
  });

  return [...merged.values()].sort((left, right) => (
    right.total_requests - left.total_requests
      || right.total_tokens - left.total_tokens
      || right.actual_cost - left.actual_cost
      || left.model.localeCompare(right.model)
  ));
}

export function hasTokenBreakdown(item) {
  return TOKEN_BREAKDOWN_FIELDS.some((field) => usageNumber(item?.[field]) > 0);
}

export function getUsageBilledTotal(models = []) {
  return models.reduce((sum, item) => sum + usageNumber(item?.actual_cost), 0);
}

export function isUsageCostReported(models = []) {
  return models.some((item) => item?.cost_reported);
}

function firstPositiveUsageNumber(values) {
  for (const value of values) {
    const number = usageNumber(value);
    if (number > 0) return number;
  }
  return null;
}

export function getUsageReferenceCost(record) {
  if (!record || typeof record !== 'object') return null;
  return firstPositiveUsageNumber(REFERENCE_COST_FIELDS.map((field) => record[field]));
}

export function getUsageEffectiveDiscount(actualCost, referenceCost) {
  const actual = usageNumber(actualCost);
  const reference = usageNumber(referenceCost);
  return actual > 0 && reference > 0 ? actual / reference : null;
}

// Per-request charge records from GET /usage; tokens and billed USD are shown
// exactly as the ledger recorded them, never recomputed client-side.
export function mapUsageRecords(records = []) {
  const list = Array.isArray(records) ? records : [];
  return list
    .filter((record) => record && record.id !== undefined && record.id !== null)
    .map((record) => {
      const inputTokens = usageNumber(record.input_tokens);
      const outputTokens = usageNumber(record.output_tokens);
      const cacheCreationTokens = usageNumber(record.cache_creation_tokens);
      const cacheReadTokens = usageNumber(record.cache_read_tokens);
      const multiplier = Number(record.rate_multiplier);
      const referenceCost = getUsageReferenceCost(record);
      return {
        id: record.id,
        createdAt: record.created_at || '',
        model: String(record.model || '').trim(),
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
        actualCost: usageNumber(record.actual_cost),
        referenceCost,
        effectiveDiscount: getUsageEffectiveDiscount(record.actual_cost, referenceCost),
        rateMultiplier: Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null,
      };
    });
}
