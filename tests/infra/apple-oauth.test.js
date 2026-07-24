import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createAppleClientSecret } from '../../tools/generate-apple-client-secret.mjs';

function decodePart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

describe('Apple OAuth client secret generator', () => {
  test('creates an Apple-compatible ES256 JWT', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const issuedAt = 1_750_000_000;
    const token = createAppleClientSecret({
      teamId: 'TEAM123456',
      clientId: 'com.luckystar.casino.web',
      keyId: 'KEY1234567',
      privateKeyPem: privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
      issuedAt,
      lifetimeSeconds: 86_400,
    });
    const [headerPart, payloadPart, signaturePart] = token.split('.');

    assert.deepEqual(decodePart(headerPart), {
      alg: 'ES256',
      kid: 'KEY1234567',
    });
    assert.deepEqual(decodePart(payloadPart), {
      iss: 'TEAM123456',
      iat: issuedAt,
      exp: issuedAt + 86_400,
      aud: 'https://appleid.apple.com',
      sub: 'com.luckystar.casino.web',
    });
    assert.equal(
      verify(
        'sha256',
        Buffer.from(`${headerPart}.${payloadPart}`),
        {
          key: publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        Buffer.from(signaturePart, 'base64url'),
      ),
      true,
    );
  });

  test('rejects a lifetime longer than Apple allows', () => {
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });

    assert.throws(
      () => createAppleClientSecret({
        teamId: 'TEAM123456',
        clientId: 'com.luckystar.casino.web',
        keyId: 'KEY1234567',
        privateKeyPem: privateKey.export({
          type: 'pkcs8',
          format: 'pem',
        }),
        lifetimeSeconds: 15_777_001,
      }),
      /lifetimeSeconds/,
    );
  });
});
