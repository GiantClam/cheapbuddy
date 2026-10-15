const DEFAULT_OPENAI_GROUP_ID = 2;
const DEFAULT_CLAUDE_GROUP_ID = 3;

function configuredGroupId(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const OPENAI_API_KEY_GROUP_ID = configuredGroupId(
  import.meta.env?.VITE_CHEAPBUDDY_GROUP_ID,
  DEFAULT_OPENAI_GROUP_ID,
);
export const CLAUDE_API_KEY_GROUP_ID = configuredGroupId(
  import.meta.env?.VITE_CLAUDE_GROUP_ID,
  DEFAULT_CLAUDE_GROUP_ID,
);

export function getModelApiKeyGroupId(model) {
  const configured = Number(model?.apiKeyGroupId);
  if (Number.isSafeInteger(configured) && configured > 0) return configured;
  if (model?.channelId === 'claude' || String(model?.id || '').startsWith('claude-')) {
    return CLAUDE_API_KEY_GROUP_ID;
  }
  return OPENAI_API_KEY_GROUP_ID;
}

export function resolveApiKeyGroupId(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const groupIds = new Set(models.map(getModelApiKeyGroupId));
  if (groupIds.size > 1) {
    const error = new Error('Selected models require different API key groups');
    error.code = 'API_KEY_GROUP_MISMATCH';
    throw error;
  }
  return [...groupIds][0];
}
