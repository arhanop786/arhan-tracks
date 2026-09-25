// ============================================================
// Correctness test for src/server/pin.ts (PBKDF2-HMAC-SHA256).
//
//   node scripts/verify-pin-hash.mjs
//
// 1. NIST PBKDF2 vectors (validate the pure-TS primitive against
//    the published test data).
// 2. Cross-check against Node's OpenSSL implementation.
// 3. Exercise the stored-format helpers (hash/verify/upgrade).
// ============================================================

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node ≥22.6 strips erasable TS types natively, but ESM needs explicit
// file extensions — so generate a temp copy of pin.ts with the one
// cross-file import (DEFAULT_STAFF_PIN) inlined, then import it.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'server', 'pin.ts'), 'utf8')
  .replace(/import\s*\{[^}]*}\s*from\s*'\.\.\/lib\/types';?/g, "const DEFAULT_STAFF_PIN = '246810';");
const tmp = mkdtempSync(join(tmpdir(), 'pinhash-'));
const tmpFile = join(tmp, 'pin.ts');
writeFileSync(tmpFile, src);
const mod = await import(pathToFileURL(tmpFile).href);
rmSync(tmp, { recursive: true, force: true });

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ✔' : '  ✘'} ${name}`);
  if (!cond) failures++;
}
const hex = (b) => Buffer.from(b).toString('hex');

console.log('1. NIST PBKDF2-HMAC-SHA256 vectors (from RFC 7914 §11 / draft-josefsson-pbkdf2-test-vectors):');
{
  // P = "passwd", S = "salt", c = 1, dkLen = 64
  const v1 = mod.pbkdf2Sha256(
    new TextEncoder().encode('passwd'),
    new TextEncoder().encode('salt'),
    1, 64,
  );
  check(
    'c=1, dkLen=64',
    hex(v1) === '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
  );
  // P = "Password", S = "NaCl", c = 80000, dkLen = 64
  const v2 = mod.pbkdf2Sha256(
    new TextEncoder().encode('Password'),
    new TextEncoder().encode('NaCl'),
    80000, 64,
  );
  check(
    'c=80000, dkLen=64',
    hex(v2) === '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
  );
}

console.log('2. Cross-check vs Node OpenSSL (random inputs):');
{
  for (let i = 0; i < 3; i++) {
    const pw = randomBytes(8 + i * 3);
    const salt = randomBytes(16);
    const iters = 1 + i * 10; // small — this loop is about wiring, not speed
    const a = mod.pbkdf2Sha256(pw, salt, iters, 32);
    const b = pbkdf2Sync(pw, salt, iters, 32, 'sha256');
    check(`pw len ${pw.length}, iters ${iters}`, hex(a) === hex(b));
  }
  // Multi-block dkLen (dkLen=64 → 2 PBKDF2 blocks)
  const pw = randomBytes(12);
  const salt = randomBytes(9); // odd length on purpose
  const a = mod.pbkdf2Sha256(pw, salt, 5, 64);
  const b = pbkdf2Sync(pw, salt, 5, 64, 'sha256');
  check('multi-block dkLen=64', hex(a) === hex(b));
  // Password longer than 64 bytes (forces HMAC key hashing path)
  const longPw = randomBytes(100);
  const a2 = mod.pbkdf2Sha256(longPw, salt, 3, 32);
  const b2 = pbkdf2Sync(longPw, salt, 3, 32, 'sha256');
  check('password > 64 bytes', hex(a2) === hex(b2));
}

console.log('3. Stored format (hash / verify / legacy upgrade):');
{
  const h = mod.hashPin('246810');
  check('hash has the pbkdf2-sha256$ prefix', mod.isPinHash(h));
  check('verify accepts the right PIN', mod.verifyPin(h, '246810'));
  check('verify rejects a wrong PIN', !mod.verifyPin(h, '246811'));
  check('two hashes of the same PIN differ (random salt)', mod.hashPin('246810') !== mod.hashPin('246810'));

  // Legacy plaintext: compares directly, flagged for upgrade
  check('plaintext row compares directly', mod.verifyPin('1111', '1111'));
  check('plaintext row rejects wrong PIN', !mod.verifyPin('1111', '2222'));
  check('plaintext flagged for upgrade', mod.pinNeedsUpgrade('1111'));
  check('hash not flagged for upgrade', !mod.pinNeedsUpgrade(h));

  // No PIN stored → shipped default
  check('undefined stored → default 246810 accepted', mod.verifyPin(undefined, '246810'));
  check('undefined stored → other rejected', !mod.verifyPin(undefined, '1111'));
}

console.log(failures === 0 ? '\nAll PIN-crypto checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
