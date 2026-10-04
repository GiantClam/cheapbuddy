export const CHEAPBUDDY_RECHARGE_URL = 'https://cheapbuddy.cc/#pricing';

const USER_BALANCE_CODE = 'INSUFFICIENT_BALANCE';
const USER_BALANCE_MESSAGE = 'Insufficient account balance';
const USER_BALANCE_MESSAGE_ZH = 'CheapBuddy balance is insufficient / CheapBuddy 账户余额不足，请充值后重试';

function errorObject(payload) {
  return payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
    ? payload.error
    : null;
}

function errorCode(payload) {
  const nested = errorObject(payload);
  return String(nested?.code || payload?.code || '').trim().toUpperCase();
}

function errorMessage(payload) {
  const nested = errorObject(payload);
  return String(nested?.message || payload?.message || '').trim();
}

export function isTextModelPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  return ['/v1/chat/completions', '/v1/responses', '/v1/messages'].includes(path);
}

export function isUserBalanceInsufficientResponse(payload, status) {
  if (errorCode(payload) === USER_BALANCE_CODE) return true;
  const message = errorMessage(payload).toLowerCase();
  if (message === USER_BALANCE_MESSAGE.toLowerCase() || message.includes('余额不足')) return true;
  return Number(status) === 402 && message === 'insufficient balance or reservation unavailable';
}

function rechargeMessage(message) {
  const base = message && message.toLowerCase() === USER_BALANCE_MESSAGE.toLowerCase()
    ? USER_BALANCE_MESSAGE_ZH
    : message || USER_BALANCE_MESSAGE_ZH;
  if (base.includes(CHEAPBUDDY_RECHARGE_URL)) return base;
  return `${base}. Recharge your CheapBuddy balance and retry: ${CHEAPBUDDY_RECHARGE_URL}`;
}

export function addRechargeGuidance(payload, status) {
  if (!payload || typeof payload !== 'object' || !isUserBalanceInsufficientResponse(payload, status)) return payload;
  const nested = errorObject(payload);
  if (nested) {
    return {
      ...payload,
      error: {
        ...nested,
        message: rechargeMessage(nested.message),
        recharge_url: CHEAPBUDDY_RECHARGE_URL,
      },
    };
  }
  return {
    ...payload,
    message: rechargeMessage(payload.message),
    recharge_url: CHEAPBUDDY_RECHARGE_URL,
  };
}
