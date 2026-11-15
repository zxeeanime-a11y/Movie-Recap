import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSecret,
  encryptSecret,
  maskApiKey,
  sanitizeErrorMessage,
  signSessionToken,
  verifySessionToken,
} from './crypto';

test('AES-256-GCM encrypts and decrypts API secrets accurately', () => {
  const secret = 'gsk_test_9876543210abcdef123456';
  const encrypted = encryptSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptSecret(encrypted), secret);
});

test('maskApiKey never exposes full secret', () => {
  const masked = maskApiKey('AIzaSyA1234567890XYZ99');
  assert.equal(masked, 'AIza••••••••YZ99');
  assert.equal(masked.includes('1234567890'), false);
});

test('session token signing and verification reject tampered or expired tokens', () => {
  const token = signSessionToken({
    userId: 'user_1',
    role: 'admin',
    exp: Date.now() + 60_000,
  });
  const verified = verifySessionToken(token);
  assert.equal(verified?.userId, 'user_1');
  assert.equal(verified?.role, 'admin');
  assert.equal(verifySessionToken(`${token}tamper`), null);

  const expired = signSessionToken({
    userId: 'user_1',
    role: 'admin',
    exp: Date.now() - 1000,
  });
  assert.equal(verifySessionToken(expired), null);
});

test('sanitizeErrorMessage redacts leaked API keys', () => {
  const msg = sanitizeErrorMessage(new Error('Request failed with AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz123'));
  assert.equal(msg.includes('AIzaSy'), false);
  assert.match(msg, /AIza\[REDACTED\]/);
});
