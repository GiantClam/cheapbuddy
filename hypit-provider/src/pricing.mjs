export function pricingRequestPath(model) {
  if (typeof model !== 'string' || model.trim().length === 0 || model.length > 200) {
    throw new Error('CheapBuddy pricing requires a valid service model');
  }
  return `/v1/pricing?model=${encodeURIComponent(model.trim())}`;
}

export function pricingSummary(document, model) {
  const multiplier = document?.cheapbuddy?.media_multiplier;
  const groupRatio = document?.group_ratio?.default;
  const parts = [`CheapBuddy/NewAPI current rate-card entry for ${model}`];
  if (typeof groupRatio === 'number') parts.push(`default group ratio ${groupRatio}`);
  if (typeof multiplier === 'number') parts.push(`CheapBuddy media multiplier ${multiplier}`);
  parts.push('the response includes original billing units; final debit uses actual successful usage');
  return parts.join('; ');
}
