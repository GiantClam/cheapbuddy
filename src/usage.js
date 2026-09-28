function usageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function mergeUsageModels(textModels = [], mediaModels = []) {
  const merged = new Map();

  [...textModels, ...mediaModels].forEach((item) => {
    const model = String(item?.model || '').trim();
    if (!model) return;
    const current = merged.get(model) || { model, total_requests: 0, total_tokens: 0, actual_cost: 0 };
    merged.set(model, {
      ...current,
      total_requests: current.total_requests + usageNumber(item.total_requests ?? item.requests),
      total_tokens: current.total_tokens + usageNumber(item.total_tokens),
      actual_cost: current.actual_cost + usageNumber(item.actual_cost),
    });
  });

  return [...merged.values()].sort((left, right) => (
    right.total_requests - left.total_requests
      || right.total_tokens - left.total_tokens
      || right.actual_cost - left.actual_cost
      || left.model.localeCompare(right.model)
  ));
}
