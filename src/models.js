export const modelCatalog = [
  {
    id: 'glm-5.3', short: 'GLM 5.3', vendor: { zh: '智谱', en: 'Zhipu' }, description: { zh: '编程、推理与 Agent 工作流', en: 'Coding, reasoning, and Agent workflows' }, input: '$1.11', output: '$3.89', accent: 'blue', mark: 'G53', showInUsageExample: true,
    maxInputTokens: 1000000, maxOutputTokens: 32768, temperature: 1,
    supportsToolCall: true, supportsImages: false, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'kimi-k3', short: 'Kimi K3', vendor: { zh: 'Kimi', en: 'Kimi' }, description: { zh: '知识工作与软件工程', en: 'Knowledge work and software engineering' }, input: '$3.00', output: '$15.00', accent: 'pink', mark: 'K3',
    maxInputTokens: 128000, maxOutputTokens: 8192, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: true,
    reasoning: { effort: 'max', defaultEffort: 'max', supportedEfforts: ['low', 'high', 'max'], summary: 'auto', canDisableThinking: false },
  },
  {
    id: 'grok-4.6', short: 'Grok 4.6', vendor: { zh: 'xAI', en: 'xAI' }, description: { zh: '代码、Agent 与知识工作', en: 'Coding, Agent workflows, and knowledge work' }, input: '$2.00', output: '$6.00', accent: 'blue', mark: 'GX', featured: true, showInUsageExample: true,
    maxInputTokens: 500000, maxOutputTokens: 8192, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'medium', defaultEffort: 'medium', supportedEfforts: ['low', 'medium', 'high', 'xhigh'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-6-astra', short: 'GPT-6 Astra', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '复杂推理、编程与 Agent 工作流', en: 'Advanced reasoning, coding, and Agent workflows' }, input: '$10.00', output: '$50.00', accent: 'violet', mark: 'A6', showInUsageExample: true,
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-5.6-sol', short: 'GPT-5.6 Sol', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '高质量编程、推理与 Agent 工作流', en: 'High-quality coding, reasoning, and Agent workflows' }, input: '$5.00', output: '$30.00', accent: 'orange', mark: 'S56', showInUsageExample: true,
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'gpt-5.6-terra', short: 'GPT-5.6 Terra', vendor: { zh: 'OpenAI', en: 'OpenAI' }, description: { zh: '高性价比长上下文与推理', en: 'Efficient long-context reasoning and coding' }, input: '$2.00', output: '$12.00', accent: 'yellow', mark: 'T56', showInUsageExample: true,
    maxInputTokens: 1050000, maxOutputTokens: 128000, temperature: 1,
    supportsToolCall: true, supportsImages: true, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], summary: 'auto', canDisableThinking: true },
  },
  {
    id: 'deepseek/deepseek-v4-flash', short: 'DeepSeek V4 Flash', vendor: { zh: 'DeepSeek', en: 'DeepSeek' }, description: { zh: '百万上下文、推理与 Agent 工具调用', en: 'Million-token context, reasoning, and Agent tool calling' }, input: '$0.14', output: '$0.28', accent: 'mint', mark: 'D4', showInUsageExample: true,
    maxInputTokens: 1000000, maxOutputTokens: 384000, temperature: 1,
    supportsToolCall: true, supportsImages: false, supportsReasoning: true, onlyReasoning: false,
    reasoning: { effort: 'high', defaultEffort: 'high', supportedEfforts: ['low', 'high', 'max'], summary: 'auto', canDisableThinking: true },
  },
];

export function localizeModel(model, language = 'zh') {
  const locale = language === 'en' ? 'en' : 'zh';
  const vendor = typeof model.vendor === 'object' ? model.vendor[locale] || model.vendor.zh : model.vendor;
  const description = typeof model.description === 'object' ? model.description[locale] || model.description.zh : model.description;
  return { ...model, vendor, description };
}

export function localizeModels(models, language = 'zh') {
  return models.map((model) => localizeModel(model, language));
}
