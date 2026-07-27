import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const APPLE_AUDIENCE = 'https://appleid.apple.com';
const MAX_LIFETIME_SECONDS = 15_777_000;
const DEFAULT_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function requireValue(value, name) {
  if (!value || value === 'CHANGE_ME') {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function createAppleClientSecret({
  teamId,
  clientId,
  keyId,
  privateKeyPem,
  issuedAt = Math.floor(Date.now() / 1000),
  lifetimeSeconds = DEFAULT_LIFETIME_SECONDS,
}) {
  requireValue(teamId, 'teamId');
  requireValue(clientId, 'clientId');
  requireValue(keyId, 'keyId');
  requireValue(privateKeyPem, 'privateKeyPem');

  if (!Number.isInteger(lifetimeSeconds) ||
      lifetimeSeconds <= 0 ||
      lifetimeSeconds > MAX_LIFETIME_SECONDS) {
    throw new Error(`lifetimeSeconds must be between 1 and ${MAX_LIFETIME_SECONDS}`);
  }

  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ec' ||
      privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Apple private key must use the P-256 elliptic curve');
  }

  const header = encodeJson({ alg: 'ES256', kid: keyId });
  const payload = encodeJson({
    iss: teamId,
    iat: issuedAt,
    exp: issuedAt + lifetimeSeconds,
    aud: APPLE_AUDIENCE,
    sub: clientId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');

  return `${signingInput}.${signature}`;
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value == null) {
      throw new Error(`Invalid argument near ${name || 'end of command'}`);
    }
    result[name.slice(2)] = value;
  }
  return result;
}

function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const privateKeyPath =
    args['private-key'] || process.env.APPLE_PRIVATE_KEY_PATH;
  const days = Number(args.days || 180);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('days must be a positive integer');
  }

  const secret = createAppleClientSecret({
    teamId: args['team-id'] || process.env.APPLE_TEAM_ID,
    clientId: args['client-id'] || process.env.APPLE_CLIENT_ID,
    keyId: args['key-id'] || process.env.APPLE_KEY_ID,
    privateKeyPem: readFileSync(
      requireValue(privateKeyPath, 'privateKeyPath'),
      'utf8',
    ),
    lifetimeSeconds: days * 24 * 60 * 60,
  });
  process.stdout.write(`${secret}\n`);
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`Unable to generate Apple client secret: ${error.message}\n`);
    process.exitCode = 1;
  }
}
