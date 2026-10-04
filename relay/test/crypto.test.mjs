import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptToken, encryptToken } from '../src/crypto.mjs';

test('shadow token encryption round trips and rejects tampering', () => {
  const encrypted = encryptToken('new-api-secret', 'test-key');
  assert.notEqual(encrypted, 'new-api-secret');
  assert.equal(decryptToken(encrypted, 'test-key'), 'new-api-secret');
  assert.throws(() => decryptToken(`${encrypted}x`, 'test-key'));
});
