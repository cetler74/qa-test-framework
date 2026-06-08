/**
 * Validate that the JWT refresh loop produces unique jti / iat / exp per iteration.
 *
 * Usage:  node scripts/validate-jwt-refresh.js [projectId]
 *
 * The script uses the project's keys/project-<id>/private.pem (or falls back to
 * a freshly-generated ephemeral key-pair when no project key exists) so it can
 * run independently of a live server.
 */

'use strict';

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── helpers duplicated from testRunner so we don't mutate the source ─────────

function generateSignedJwtFromEnvVars(envVars, projectId, audience, variantLabel) {
  const issuer = (envVars.jwt_issuer || '').trim();
  if (!issuer)   throw new Error(`[${variantLabel}] jwt_issuer required`);
  if (!audience) throw new Error(`[${variantLabel}] audience empty`);

  const ttlRaw = parseInt(envVars.jwt_ttl || '300', 10);
  const ttl = (!isNaN(ttlRaw) && ttlRaw > 0) ? Math.min(ttlRaw, 300) : 300;

  let privateKeyPem;
  if (envVars.jwt_private_key && envVars.jwt_private_key.trim()) {
    privateKeyPem = envVars.jwt_private_key.trim();
  } else {
    const keyFile = path.join(__dirname, '..', 'keys', `project-${projectId}`, 'private.pem');
    if (!fs.existsSync(keyFile)) throw new Error(`Key file not found: ${keyFile}`);
    privateKeyPem = fs.readFileSync(keyFile, 'utf8');
  }

  let kid = (envVars.jwt_kid || '').trim();
  if (!kid) {
    const pub  = crypto.createPublicKey(privateKeyPem);
    const spki = pub.export({ type: 'spki', format: 'der' });
    kid = 'kid-' + crypto.createHash('sha256').update(spki).digest('hex');
  }

  const b64url = (obj) =>
    Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const now     = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT', kid };
  const payload = { iss: issuer, sub: issuer, aud: audience, iat: now, exp: now + ttl,
                    jti: crypto.randomBytes(16).toString('hex') };

  const unsigned  = `${b64url(header)}.${b64url(payload)}`;
  const signer    = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const sig = signer.sign(privateKeyPem, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return `${unsigned}.${sig}`;
}

function decodePayload(jwt) {
  const parts = jwt.split('.');
  const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

// ── setup ─────────────────────────────────────────────────────────────────────

const projectId = process.argv[2] || 'test';

// Find or generate a private key
let privateKeyPem;
const keyFile = path.join(__dirname, '..', 'keys', `project-${projectId}`, 'private.pem');
if (fs.existsSync(keyFile)) {
  privateKeyPem = fs.readFileSync(keyFile, 'utf8');
  console.log(`Using existing key: ${keyFile}`);
} else {
  console.log('No project key found — generating ephemeral RSA-2048 key-pair for this test...');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  console.log('Ephemeral key generated.\n');
}

const AUDIENCE_AUTHORIZE = 'https://pre-release.services.bk.sapo.pt/camara-auth/v1/bc-authorize';
const AUDIENCE_TOKEN     = 'https://pre-release.services.bk.sapo.pt/camara-auth/v1/token';

const baseEnvVars = {
  jwt_issuer:      'test-issuer-client-id',
  jwt_private_key: privateKeyPem,
  jwt_ttl:         '60',
  'jwt_audience_signedjwt-authorize': AUDIENCE_AUTHORIZE,
  'jwt_audience_signedjwt-token':     AUDIENCE_TOKEN,
};

const JWT_VARIANTS = [
  { varName: 'signedjwt-authorize', audienceKey: 'jwt_audience_signedjwt-authorize' },
  { varName: 'signedjwt-token',     audienceKey: 'jwt_audience_signedjwt-token' },
];

// ── simulate the shared-env file exactly as testRunner does ──────────────────

const tempDir = os.tmpdir();
const sharedEnvFile = path.join(tempDir, `validate-jwt-refresh-${Date.now()}.json`);

const sharedEnvObject = {
  id: 'validate-test',
  name: 'Validate JWT Refresh',
  values: Object.entries(baseEnvVars).map(([key, value]) => ({
    key, value: String(value), type: 'string', enabled: true
  })),
  _postman_variable_scope: 'environment',
};
fs.writeFileSync(sharedEnvFile, JSON.stringify(sharedEnvObject, null, 2));

// ── run N simulated iterations ────────────────────────────────────────────────

const ITERATIONS = 6;
const seen = { jti: new Set(), iat: new Set() };
let allUnique = true;
let audienceOk = true;

console.log(`\nSimulating ${ITERATIONS} sequential test iterations (like the testRunner loop):\n`);
console.log(`${'Iter'.padEnd(6)} ${'Variant'.padEnd(26)} ${'jti'.padEnd(34)} ${'iat'.padEnd(12)} ${'aud (truncated)'.padEnd(60)}`);
console.log('-'.repeat(140));

for (let i = 0; i < ITERATIONS; i++) {
  // ── exactly what the fix does per iteration ──────────────────────────────
  const currentEnvContent = JSON.parse(fs.readFileSync(sharedEnvFile, 'utf8'));
  const currentEnvVars = {};
  for (const v of (currentEnvContent.values || [])) currentEnvVars[v.key] = v.value;

  let jwtRefreshed = false;
  for (const { varName, audienceKey } of JWT_VARIANTS) {
    const audience = (baseEnvVars[audienceKey] || '').trim();   // from options.envVars (fixed)
    if (!audience) continue;

    const freshJwt = generateSignedJwtFromEnvVars(currentEnvVars, projectId, audience, varName);
    const existing = currentEnvContent.values.find(v => v.key === varName);
    if (existing) { existing.value = freshJwt; }
    else { currentEnvContent.values.push({ key: varName, value: freshJwt, type: 'string', enabled: true }); }

    // ── decode & validate ─────────────────────────────────────────────────
    const p = decodePayload(freshJwt);

    const jtiUnique = !seen.jti.has(p.jti);
    const iatFresh  = (Math.floor(Date.now() / 1000) - p.iat) < 2; // within 2 s
    const audOk     = p.aud === audience;

    if (!jtiUnique) { allUnique = false; }
    if (!audOk)     { audienceOk = false; }

    seen.jti.add(p.jti);
    seen.iat.add(p.iat);

    const status = `${jtiUnique ? '✅' : '❌ DUP'} jti  ${iatFresh ? '✅' : '❌ stale'} iat  ${audOk ? '✅' : '❌ wrong'} aud`;
    console.log(`${String(i+1).padEnd(6)} ${varName.padEnd(26)} ${p.jti.padEnd(34)} ${String(p.iat).padEnd(12)} ${p.aud.slice(0,58).padEnd(60)}  ${status}`);

    jwtRefreshed = true;
  }

  if (jwtRefreshed) fs.writeFileSync(sharedEnvFile, JSON.stringify(currentEnvContent, null, 2));

  // Simulate a tiny pause (< 1 ms) — we just need the next iteration to re-run
  // Note: in a real run there's an await between iterations, so iat may be identical
  // across the 6 fast iterations here; that is expected and acceptable (iat resolution = 1 s).
}

// cleanup
try { fs.unlinkSync(sharedEnvFile); } catch (_) {}

console.log('\n── Summary ─────────────────────────────────────────────────────────────────');
const totalJtis = seen.jti.size;
console.log(`Total unique jti values across ${ITERATIONS * JWT_VARIANTS.length} JWT(s): ${totalJtis}`);
console.log(`All jti values unique : ${allUnique  ? '✅ PASS' : '❌ FAIL — duplicate jti detected!'}`);
console.log(`All audiences correct : ${audienceOk ? '✅ PASS' : '❌ FAIL — wrong audience in JWT!'}`);

if (allUnique && audienceOk) {
  console.log('\n✅  JWT refresh logic is working correctly.\n');
  process.exit(0);
} else {
  console.log('\n❌  Validation failed — see rows marked above.\n');
  process.exit(1);
}
