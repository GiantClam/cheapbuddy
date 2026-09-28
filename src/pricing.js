// Customer-facing recharge tiers. The backend receives the amount field in yuan;
// Sub2API remains the source of truth for the user's balance and billing.
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
