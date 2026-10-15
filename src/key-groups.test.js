import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAUDE_API_KEY_GROUP_ID,
  OPENAI_API_KEY_GROUP_ID,
  getModelApiKeyGroupId,
  resolveApiKeyGroupId,
} from './key-groups.js';

test('uses the production OpenAI and Claude group defaults', () => {
  assert.equal(OPENAI_API_KEY_GROUP_ID, 2);
  assert.equal(CLAUDE_API_KEY_GROUP_ID, 3);
});

test('resolves Claude models independently of a catalog-embedded group id', () => {
  assert.equal(getModelApiKeyGroupId({ id: 'claude-sonnet-5-5' }), CLAUDE_API_KEY_GROUP_ID);
  assert.equal(getModelApiKeyGroupId({ channelId: 'claude', id: 'custom-claude-alias' }), CLAUDE_API_KEY_GROUP_ID);
  assert.equal(getModelApiKeyGroupId({ id: 'gpt-6.1-sol' }), OPENAI_API_KEY_GROUP_ID);
  assert.equal(getModelApiKeyGroupId({ id: 'custom-model', apiKeyGroupId: 17 }), 17);
});

test('rejects a configuration that needs more than one API key group', () => {
  assert.throws(
    () => resolveApiKeyGroupId([{ id: 'claude-sonnet-5-5' }, { id: 'gpt-6.1-sol' }]),
    (error) => error.code === 'API_KEY_GROUP_MISMATCH',
  );
  assert.equal(resolveApiKeyGroupId([]), null);
  assert.equal(resolveApiKeyGroupId([{ id: 'claude-opus-5' }]), CLAUDE_API_KEY_GROUP_ID);
});
