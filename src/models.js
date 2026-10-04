import { USD_TO_CNY_RATE } from './payment.js';

export const modelCatalog = [
  {
    id: 'glm-5.3', short: 'GLM 5.3', vendor: { zh: '智谱', en: 'Zhipu' }, description: { zh: '编程、推理与 Agent 工作流', en: 'Coding, reasoning, and Agent workflows' }, input: '待核验', output: '待核验', priceStatus: 'unverified', priceSourceUrl: 'https://open.bigmodel.cn/pricing', priceCheckedAt: '2026-09-26', priceUnit: { zh: '官网价格暂不可核验', en: 'Official rate not verified' }, accent: 'blue', mark: 'G53', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1000000, maxOutputTokens: 32768, temperature: 1,
    supportsToolCall: true, supportsImages: false, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'glm-5.3-flash', short: 'GLM 5.3 Flash', vendor: { zh: '智谱', en: 'Zhipu' }, description: { zh: '多模态理解、编程与 Agent 工作流', en: 'Multimodal understanding, coding, and Agent workflows' }, input: '待核验', output: '待核验', priceStatus: 'unverified', priceSourceUrl: 'https://open.bigmodel.cn/pricing', priceCheckedAt: '2026-09-26', priceUnit: { zh: '官网价格暂不可核验', en: 'Official rate not verified' }, accent: 'cyan', mark: 'G53F', modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1000000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: true,
    reasoning: { effort: 'max', defaultEffort: 'max', supportedEfforts: ['high', 'max'], summary: 'auto', canDisableThinking: false },
  },
  {
    id: 'kimi-k3', short: 'Kimi K3', vendor: { zh: 'Kimi', en: 'Kimi' }, description: { zh: '知识工作与软件工程', en: 'Knowledge work and software engineering' }, input: '待核验', output: '待核验', priceStatus: 'unverified', priceSourceUrl: 'https://platform.kimi.ai/docs/pricing/chat', priceCheckedAt: '2026-09-26', priceUnit: { zh: '官网价格暂不可核验', en: 'Official rate not verified' }, accent: 'pink', mark: 'K3', modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1000000, maxOutputTokens: 131072, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: true,
    reasoning: { effort: 'max', defaultEffort: 'max', supportedEfforts: ['low', 'high', 'max'], summary: 'auto', canDisableThinking: false },
  },
  {
    id: 'grok-4.7', short: 'Grok 4.7', vendor: { zh: 'xAI', en: 'xAI' }, description: { zh: '代码、Agent 与知识工作', en: 'Coding, Agent workflows, and knowledge work' }, input: '$2.00–$4.00', output: '$6.00–$12.00', priceStatus: 'verified', priceSourceUrl: 'https://docs.x.ai/developers/models/grok-4.7', priceCheckedAt: '2026-09-26', priceUnit: { zh: '美元 / 百万 Token；缓存输入 $0.50 / 百万，超过 200K 上下文费率更高', en: 'USD / MTok; cached input $0.50 / MTok; higher rates above 200K context' }, accent: 'blue', mark: 'GX', featured: true, showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 500000, maxOutputTokens: 8192, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'medium', defaultEffort: 'medium', supportedEfforts: ['low', 'medium', 'high', 'xhigh'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-6-astra', short: 'GPT-6 Astra', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '复杂推理、编程与 Agent 工作流', en: 'Advanced reasoning, coding, and Agent workflows' }, input: '$10.00', output: '$50.00', priceStatus: 'verified', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', priceCheckedAt: '2026-09-26', priceUnit: { zh: '美元 / 百万 Token；缓存 $1.00，缓存写入 $12.50；超过 272K 输入的长上下文加价', en: 'USD / MTok; cached $1.00, cache write $12.50; higher rates above 272K input tokens' }, accent: 'violet', mark: 'A6', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-6-sol', short: 'GPT-6 Sol', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '高质量编程、推理与 Agent 工作流', en: 'High-quality coding, reasoning, and Agent workflows' }, input: '$2.00', output: '$10.00', priceStatus: 'verified', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', priceCheckedAt: '2026-09-26', priceUnit: { zh: '美元 / 百万 Token；缓存 $0.20，缓存写入 $2.50；超过 272K 输入的长上下文加价', en: 'USD / MTok; cached $0.20, cache write $2.50; higher rates above 272K input tokens' }, accent: 'orange', mark: 'S6', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-6.1-sol', short: 'GPT-6.1 Sol', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '高质量编程、推理与 Agent 工作流', en: 'High-quality coding, reasoning, and Agent workflows' }, input: '$2.00', output: '$10.00', priceStatus: 'verified', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', priceCheckedAt: '2026-09-30', priceUnit: { zh: '美元 / 百万 Token；缓存读取 $0.10，缓存写入 $2.50；超过 272K 输入的长上下文加价', en: 'USD / MTok; cached input $0.10, cache write $2.50; higher rates above 272K input tokens' }, accent: 'orange', mark: 'S61', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 922000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: false },
  },
  {
    id: 'gpt-6-luna', short: 'GPT-6 Luna', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '高性价比日常任务与高频调用', en: 'Efficient everyday tasks and high-volume workloads' }, input: '$0.10', output: '$0.50', priceStatus: 'verified', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', priceCheckedAt: '2026-09-26', priceUnit: { zh: '美元 / 百万 Token；缓存 $0.01，缓存写入 $0.125；超过 272K 输入的长上下文加价', en: 'USD / MTok; cached $0.01, cache write $0.125; higher rates above 272K input tokens' }, accent: 'yellow', mark: 'L6', modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'medium', defaultEffort: 'medium', supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-5.6-sol', short: 'GPT-5.6 Sol', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '高质量编程、推理与 Agent 工作流', en: 'High-quality coding, reasoning, and Agent workflows' }, input: '$4.00', output: '$20.00', priceStatus: 'verified', priceSourceUrl: 'https://developers.openai.com/api/docs/pricing', priceCheckedAt: '2026-09-26', priceUnit: { zh: '美元 / 百万 Token；缓存 $0.40，缓存写入 $5.00；优惠价至少持续至 2026-11-21', en: 'USD / MTok; cached $0.40, cache write $5.00; promotional rates available through at least 2026-11-21' }, accent: 'orange', mark: 'S56', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-5.6-terra', short: 'GPT-5.6 Terra', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '高性价比长上下文与推理', en: 'Efficient long-context reasoning and coding' }, input: '$2.00', output: '$12.00', priceStatus: 'verified', priceSourceUrl: 'https://developers.openai.com/api/docs/models/gpt-5.6-terra', priceCheckedAt: '2026-09-26', priceUnit: { zh: '美元 / 百万 Token；缓存 $0.20，缓存写入 $2.50；超过 272K 输入的长上下文加价', en: 'USD / MTok; cached $0.20, cache write $2.50; higher rates above 272K input tokens' }, accent: 'yellow', mark: 'T56', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'deepseek/deepseek-v4.1-flash', short: 'DeepSeek V4.1 Flash', vendor: { zh: 'DeepSeek', en: 'DeepSeek' }, description: { zh: '百万上下文、多模态理解与 Agent 工具调用', en: 'Million-token context, multimodal understanding, and Agent tool calling' }, input: '¥0.02–¥0.04 缓存 · ¥1–¥2 未缓存', output: '¥4–¥8', priceStatus: 'verified', providerModelId: 'deepseek-flash', priceSourceUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', priceCheckedAt: '2026-09-26', priceUnit: { zh: '人民币 / 百万 Token；输入输出均按高峰/闲时变化，具体时段见官网', en: 'CNY / MTok; peak/off-peak rates apply to input and output; see provider schedule' }, accent: 'mint', mark: 'D41', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 1000000, maxOutputTokens: 384000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'high', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'qwen3.8-max', short: 'Qwen 3.8 Max', vendor: { zh: '通义千问', en: 'Qwen' }, description: { zh: '旗舰推理、视觉理解与 Agent 工具调用', en: 'Flagship reasoning, vision, and Agent tool use' }, input: '¥12.00', output: '¥36.00', priceStatus: 'verified', providerModelId: 'qwen3.8-max', priceSourceUrl: 'https://help.aliyun.com/zh/model-studio/qwen3-8-max', priceCheckedAt: '2026-09-26', priceUnit: { zh: '人民币 / 百万 Token；北京地域缓存命中 ¥1.50，国际地域原价不同', en: 'CNY / MTok; Beijing cached input ¥1.50; international region has different rates' }, accent: 'blue', mark: 'Q38', showInUsageExample: true, modality: 'text', endpointPath: '/chat/completions', billingUnit: { zh: 'Token 计费', en: 'Token billing' },
    maxInputTokens: 991808, maxOutputTokens: 131072, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'medium', defaultEffort: 'medium', supportedEfforts: ['low', 'medium', 'high'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-image-2.5', short: 'GPT Image 2.5', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '图片生成与编辑，使用独立图片接口', en: 'Image generation and editing through the image API' }, input: '按任务', output: '按图片', accent: 'violet', mark: 'IMG', featured: true, modality: 'image', endpointPath: '/images/generations', billingUnit: { zh: '媒体用量计费', en: 'Media usage billing' },
    maxInputTokens: 128000, maxOutputTokens: 1, temperature: 1,
    supportsToolCall: false, supportsImages: true, supportsReasoning: false, onlyReasoning: false,
  },
  {
    id: 'MiniMax-H3', short: 'MiniMax H3', vendor: { zh: 'MiniMax', en: 'MiniMax' }, description: { zh: '异步视频生成：文生、图生与参考素材生成', en: 'Async text-to-video, image-to-video, and reference-to-video generation' }, input: '$0.08 / 秒', output: '768P', priceStatus: 'verified', priceSourceUrl: 'https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise', priceCheckedAt: '2026-09-26', priceUnit: { zh: '官网 API 参考价：768P 输出；2K 官网价 $0.13/秒。本模型卡展示官网价，不代表本站最终扣款。', en: 'Official API reference: 768P output; 2K is $0.13/sec. This card shows the official rate, not CheapBuddy’s final charge.' }, accent: 'orange', mark: 'H3', featured: true, modality: 'video', endpointPath: '/videos', billingUnit: { zh: '视频生成 · 官网 768P 参考价', en: 'Video generation · official 768P reference rate' },
    maxInputTokens: 128000, maxOutputTokens: 1, temperature: 1,
    supportsToolCall: false, supportsImages: true, supportsReasoning: false, onlyReasoning: false,
  },
];

const monetaryAmountPattern = /([$¥])\s*(\d+(?:\.\d+)?)/g;

function formatConvertedAmount(amount) {
  const rounded = Math.round((amount + Number.EPSILON) * 10000) / 10000;
  const [integer, fraction] = rounded.toFixed(4).split('.');
  return `${integer}.${fraction.replace(/0+$/, '').padEnd(2, '0')}`;
}

function getPriceCurrency(model) {
  if (model.priceStatus !== 'verified') return null;
  const symbols = new Set(`${model.input || ''} ${model.output || ''}`.match(/[$¥]/g) || []);
  if (symbols.size !== 1) return null;
  return symbols.has('$') ? 'USD' : 'CNY';
}

function convertMoneyText(value, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency || !value) return value;
  const fromSymbol = fromCurrency === 'USD' ? '$' : '¥';
  const toSymbol = toCurrency === 'USD' ? '$' : '¥';
  const exchange = fromCurrency === 'USD' ? USD_TO_CNY_RATE : 1 / USD_TO_CNY_RATE;
  return value.replace(monetaryAmountPattern, (match, symbol, amount) => {
    if (symbol !== fromSymbol) return match;
    return `${toSymbol}${formatConvertedAmount(Number(amount) * exchange)}`;
  });
}

function localizePriceText(value, locale) {
  if (!value) return value;
  return locale === 'en'
    ? value.replace(/未缓存/g, 'uncached').replace(/缓存/g, 'cached').replace(/\/\s*秒/g, '/ sec')
    : value.replace(/\/\s*sec\b/g, '/ 秒');
}

function localizePriceUnit(value, locale, fromCurrency, toCurrency) {
  if (!value || !fromCurrency || fromCurrency === toCurrency) return value;
  let localized = convertMoneyText(value, fromCurrency, toCurrency);
  if (fromCurrency === 'USD') {
    localized = localized.replace(/\bUSD\b/g, 'CNY').replace(/美元/g, '人民币');
  } else {
    localized = localized.replace(/\bCNY\b/g, 'USD');
  }
  const note = locale === 'en'
    ? `Reference conversion: 1 USD = ${USD_TO_CNY_RATE} CNY`
    : `参考汇率：1 USD = ${USD_TO_CNY_RATE} CNY`;
  return `${localized}${locale === 'en' ? '; ' : '；'}${note}`;
}

export function localizeModel(model, language = 'zh') {
  const locale = language === 'en' ? 'en' : 'zh';
  const vendor = typeof model.vendor === 'object' ? model.vendor[locale] || model.vendor.zh : model.vendor;
  const description = typeof model.description === 'object' ? model.description[locale] || model.description.zh : model.description;
  const billingUnit = typeof model.billingUnit === 'object' ? model.billingUnit[locale] || model.billingUnit.zh : model.billingUnit;
  const sourcePriceUnit = typeof model.priceUnit === 'object' ? model.priceUnit[locale] || model.priceUnit.zh : model.priceUnit;
  const fromCurrency = getPriceCurrency(model);
  const toCurrency = locale === 'en' ? 'USD' : 'CNY';
  const input = localizePriceText(convertMoneyText(model.input, fromCurrency, toCurrency), locale);
  const output = localizePriceText(convertMoneyText(model.output, fromCurrency, toCurrency), locale);
  const priceUnit = localizePriceUnit(sourcePriceUnit, locale, fromCurrency, toCurrency);
  return { ...model, vendor, description, billingUnit, input, output, priceUnit };
}

export function localizeModels(models, language = 'zh') {
  return models.map((model) => localizeModel(model, language));
}
