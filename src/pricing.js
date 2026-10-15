import { selectPaymentType } from './payment.js';

// Public promotional examples. Authenticated purchase offers and amounts come
// from checkout-info; these examples are never submitted as order prices.
export const pricingPlans = [
  {
    id: 'trial',
    name: '体验包',
    nameKey: 'planTrial',
    amount: 3,
    description: '先试一轮，再决定长期使用',
    descriptionKey: 'planTrialDescription',
    tag: '¥3 起',
    tagKey: 'planTrialTag',
  },
  {
    id: 'standard',
    name: '标准包',
    nameKey: 'planStandard',
    amount: 15,
    description: '日常 WorkBuddy 使用',
    descriptionKey: 'planStandardDescription',
    tag: '最常用',
    tagKey: 'planStandardTag',
    featured: true,
  },
  {
    id: 'regular',
    name: '常用包',
    nameKey: 'planRegular',
    amount: 30,
    description: '适合持续使用多个模型',
    descriptionKey: 'planRegularDescription',
    tag: '推荐',
    tagKey: 'planRegularTag',
  },
  {
    id: 'heavy',
    name: '重度包',
    nameKey: 'planHeavy',
    amount: 90,
    description: '长上下文与 Agent 任务',
    descriptionKey: 'planHeavyDescription',
    tag: '重度使用',
    tagKey: 'planHeavyTag',
  },
  {
    id: 'team',
    name: '团队包',
    nameKey: 'planTeam',
    amount: 150,
    description: '多设备、多模型共用',
    descriptionKey: 'planTeamDescription',
    tag: '大额充值',
    tagKey: 'planTeamTag',
  },
];

export const defaultPricingPlan = pricingPlans.find((plan) => plan.featured) || pricingPlans[0];

export function getModelRetailPricing(model) {
  if (model.pricingScope === 'sub2api-group') return null;
  if (model.modality !== 'text' || model.priceStatus !== 'verified' ||
      !Number.isFinite(model.priceMultiplier) || model.priceMultiplier <= 0) return null;
  const scale = (value) => typeof value === 'string'
    ? value.replace(/([$¥])\s*(\d+(?:\.\d+)?)/g, (_match, currency, amount) => {
      const rounded = Math.round((Number(amount) * model.priceMultiplier + Number.EPSILON) * 10000) / 10000;
      const [integer, fraction] = rounded.toFixed(4).split('.');
      return `${currency}${integer}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
    })
    : value;
  return { input: scale(model.input), output: scale(model.output), priceUnit: scale(model.priceUnit) };
}

export function getCheckoutRechargePlans(checkout, language) {
  if (!checkout || checkout.balance_disabled || !Array.isArray(checkout.recharge_tiers)) return [];
  const currency = language === 'en' ? 'USD' : 'CNY';
  return checkout.recharge_tiers.flatMap((tier) => {
    if (!tier?.id || tier.order_type !== 'balance' || !Array.isArray(tier.payment_options)) return [];
    const isValidOption = (option) => option?.currency === currency && Number.isFinite(option.amount) && option.amount > 0 &&
      Number.isFinite(option.pay_amount) && option.pay_amount > 0 && Number.isFinite(option.credited_balance) && option.credited_balance >= 0;
    const allowedMethods = Object.fromEntries(Object.entries(checkout.methods || {}).filter(([type, method]) =>
      method?.currency === currency && tier.payment_options.some((option) => option?.payment_type === type && isValidOption(option))));
    const paymentType = selectPaymentType(allowedMethods, language);
    if (!paymentType) return [];
    const option = tier.payment_options.find((candidate) => candidate?.payment_type === paymentType && candidate.currency === currency);
    if (!isValidOption(option)) return [];
    return [{
      id: tier.id, name: tier.name, description: tier.description, featured: Boolean(tier.featured),
      amount: option.amount, payAmount: option.pay_amount, creditedBalance: option.credited_balance,
      paymentCurrency: currency, paymentType,
    }];
  });
}
