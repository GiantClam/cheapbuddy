import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function keyBytes(secret) {
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(token, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptToken(value, secret) {
  const [ivText, tagText, ciphertextText] = String(value).split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('invalid encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secret), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}
