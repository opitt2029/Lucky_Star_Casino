import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAppleClientSecret } from '../../tools/generate-apple-client-secret.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

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

// ─────────────────────────────────────────────────────────────────────────────
// Apple 私鑰的忽略規則曾在 PR #271 被無聲刪除（當時沒有任何測試守著它），
// 而 DEPLOY.md 仍寫著「專案已忽略所有 .p8 檔案」。以下斷言把文件承諾釘成機械檢查。
// ─────────────────────────────────────────────────────────────────────────────
describe('Apple OAuth 私鑰不得進入 repo', () => {

  const ignoreRules = readFileSync(resolve(ROOT, '.gitignore'), 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  for (const rule of ['*.p8', 'apple-client-secret*.txt']) {
    test(`.gitignore 應忽略 ${rule}`, () => {
      assert.ok(
        ignoreRules.includes(rule),
        `.gitignore 缺少 ${rule}；Apple 簽章私鑰只能下載一次，誤 commit 無法挽回`,
      );
    });
  }

  test('repo 內不應存在任何已追蹤的 .p8 或 client secret 檔案', () => {
    const tracked = execFileSync(
      'git',
      ['ls-files', '-z', '*.p8', 'apple-client-secret*.txt'],
      { cwd: ROOT, encoding: 'utf-8' },
    )
      .split('\0')
      .filter(Boolean);

    assert.deepEqual(tracked, [], `以下機密檔案已被 git 追蹤：${tracked.join(', ')}`);
  });

});
