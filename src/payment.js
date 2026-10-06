const PAYMENT_TYPES = Object.freeze({
  STRIPE: 'stripe',
  EASYPAY: 'easypay',
  ALIPAY: 'alipay',
  ALIPAY_DIRECT: 'alipay_direct',
});

// Reference conversion for public payment examples; authenticated quotes come from checkout-info.
export const USD_TO_CNY_RATE = 6.5;

export function getPlanPaymentAmount(amount, language) {
  const normalizedAmount = Number(amount) || 0;
  if (language !== 'en') return normalizedAmount;
  return Math.round((normalizedAmount / USD_TO_CNY_RATE) * 100) / 100;
}

function isAvailable(methods, type) {
  const method = methods?.[type];
  return Boolean(method && method.available !== false);
}

// English checkout is intentionally Stripe-only so it can charge USD.
export function selectPaymentType(methods, language) {
  if (language === 'en') return isAvailable(methods, PAYMENT_TYPES.STRIPE) ? PAYMENT_TYPES.STRIPE : '';
  return [PAYMENT_TYPES.EASYPAY, PAYMENT_TYPES.ALIPAY, PAYMENT_TYPES.ALIPAY_DIRECT]
    .find((type) => isAvailable(methods, type)) || '';
}

export function getPaymentCurrency(method, methodConfig) {
  const configured = String(methodConfig?.currency || '').trim().toUpperCase();
  if (configured) return configured;
  return method === PAYMENT_TYPES.STRIPE ? 'USD' : 'CNY';
}

export function formatPaymentAmount(amount, currency, fractionDigits = 2) {
  const normalizedCurrency = String(currency || 'CNY').trim().toUpperCase();
  try {
    return new Intl.NumberFormat(normalizedCurrency === 'USD' ? 'en-US' : 'zh-CN', {
      style: 'currency',
      currency: normalizedCurrency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(Number(amount) || 0);
  } catch {
    return `${normalizedCurrency} ${Number(amount) || 0}`;
  }
}

export function formatLedgerAmount(amount, fractionDigits = 2) {
  return `${formatPaymentAmount(amount, 'USD', fractionDigits)} USD`;
}

export function formatPaymentOrderAmount(order) {
  return formatPaymentAmount(order.pay_amount ?? order.amount ?? 0, getPaymentCurrency(order.payment_type, order));
}

export function getRechargeLedgerAmount(plan) {
  // Server credited_balance is already denominated in ledger USD, regardless of payment currency.
  if (Number.isFinite(plan.creditedBalance)) return plan.creditedBalance;
  return Number(plan.amount || 0) / USD_TO_CNY_RATE;
}

export function isStripePaymentType(method) {
  return method === PAYMENT_TYPES.STRIPE;
}

export function hasPaymentCurrency(methods, type, currency) {
  const configured = String(methods?.[type]?.currency || '').trim().toUpperCase();
  return Boolean(configured && configured === String(currency || '').trim().toUpperCase());
}

export { PAYMENT_TYPES };
