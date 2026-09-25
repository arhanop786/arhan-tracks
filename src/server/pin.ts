// ============================================================
// Per-staff PIN security — salted PBKDF2-HMAC-SHA256.
//
// Stored format:  pbkdf2-sha256$<iters>$<saltHex>$<hashHex>
//   • 16-byte random salt per staff member
//   • PBKDF2-HMAC-SHA256 (RFC 2898/8018), 120k iterations, 32-byte key
//   • constant-time comparison — no early return on mismatch
//
// Pure TypeScript (no node:crypto, no SubtleCrypto) so it runs
// identically in Node, Vite builds, and the browser bundle — and
// stays synchronous like the rest of the engine. Correctness is
// pinned by NIST PBKDF2 vectors in scripts/verify-pin-hash.mjs.
//
// Legacy rows that still hold a plaintext PIN upgrade transparently:
// the first successful plaintext login re-saves the row as a hash.
// ============================================================

import { DEFAULT_STAFF_PIN } from '../lib/types';

const PBKDF2_ITERATIONS = 120_000;
const KEYLEN = 32; // bytes
const SALT_BYTES = 16;

// ---------- SHA-256 (FIPS 180-4) ----------

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

// denormalized round constants (K) — standard table
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// Shared scratch (JS is single-threaded; avoids per-call allocations)
const W = new Uint32Array(64);
const BLOCK = new Uint8Array(64);

/** One SHA-256 compression round over the 64-byte block at `off`. */
function compress(state: Uint32Array, p: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) {
    const j = off + (i << 2);
    W[i] = ((p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3]) | 0;
  }
  for (let i = 16; i < 64; i++) {
    const w15 = W[i - 15];
    const w2 = W[i - 2];
    const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
    const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    h = g; g = f; f = e;
    e = (d + t1) | 0;
    d = c; c = b; b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0;
  state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0;
  state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0;
  state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0;
  state[7] = (state[7] + h) | 0;
}

function digestTo(out: Uint8Array, s: Uint32Array): void {
  for (let i = 0; i < 8; i++) {
    const v = s[i];
    out[i << 2] = (v >>> 24) & 0xff;
    out[(i << 2) + 1] = (v >>> 16) & 0xff;
    out[(i << 2) + 2] = (v >>> 8) & 0xff;
    out[(i << 2) + 3] = v & 0xff;
  }
}

/** Full SHA-256 of an arbitrary-length message. */
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const total = ((len + 9 + 63) >> 6) << 6; // smallest 64-multiple ≥ len+9
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  const hi = Math.floor(bits / 2 ** 32);
  const lo = bits % 2 ** 32;
  buf[total - 8] = (hi >>> 24) & 0xff;
  buf[total - 7] = (hi >>> 16) & 0xff;
  buf[total - 6] = (hi >>> 8) & 0xff;
  buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff;
  buf[total - 3] = (lo >>> 16) & 0xff;
  buf[total - 2] = (lo >>> 8) & 0xff;
  buf[total - 1] = lo & 0xff;
  const state = Uint32Array.from(IV);
  for (let off = 0; off < total; off += 64) compress(state, buf, off);
  const out = new Uint8Array(32);
  digestTo(out, state);
  return out;
}

// ---------- HMAC-SHA256 with precomputed key states ----------

function hmacKeySetup(key: Uint8Array): { inner: Uint32Array; outer: Uint32Array } {
  const k = key.length > 64 ? sha256(key) : key;
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const kb = i < k.length ? k[i] : 0;
    ipad[i] = kb ^ 0x36;
    opad[i] = kb ^ 0x5c;
  }
  const inner = Uint32Array.from(IV);
  const outer = Uint32Array.from(IV);
  compress(inner, ipad, 0);
  compress(outer, opad, 0);
  return { inner, outer };
}

const D1 = new Uint8Array(32);
const OUTER_BLOCK = new Uint8Array(64);

/** HMAC over a short message (≤ 55 bytes) — all our PBKDF2 messages qualify. */
function hmacShort(inner: Uint32Array, outer: Uint32Array, msg: Uint8Array, out: Uint8Array): void {
  if (msg.length > 55) throw new Error('hmacShort: message too long');
  // Inner: H(innerState || msg || pad) — BLOCK is the full 64-byte block.
  BLOCK.fill(0);
  BLOCK.set(msg);
  BLOCK[msg.length] = 0x80;
  // Length counts the WHOLE message: the 64-byte key block already absorbed
  // into the midstate, plus this tail — not just the tail.
  const bits = (64 + msg.length) * 8;
  BLOCK[60] = (bits >>> 24) & 0xff;
  BLOCK[61] = (bits >>> 16) & 0xff;
  BLOCK[62] = (bits >>> 8) & 0xff;
  BLOCK[63] = bits & 0xff;
  TMP_STATE.set(inner);
  compress(TMP_STATE, BLOCK, 0);
  digestTo(D1, TMP_STATE);
  // Outer: block = innerDigest(32) || 0x80 || zeros || len=768 bits (0x0300)
  // — 64-byte opad block + 32-byte inner digest = 96 bytes total.
  OUTER_BLOCK.fill(0);
  OUTER_BLOCK.set(D1);
  OUTER_BLOCK[32] = 0x80;
  OUTER_BLOCK[62] = 0x03;
  OUTER_BLOCK[63] = 0x00;
  TMP_STATE.set(outer);
  compress(TMP_STATE, OUTER_BLOCK, 0);
  digestTo(out, TMP_STATE);
}

const TMP_STATE = new Uint32Array(8);

// ---------- PBKDF2 (RFC 2898) ----------

/** PBKDF2-HMAC-SHA256. dkLen ≤ 32 keeps every PRF message in one block. */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, dkLen = 32): Uint8Array {
  const { inner, outer } = hmacKeySetup(password);
  const out = new Uint8Array(dkLen);
  const saltMsg = new Uint8Array(salt.length + 4);
  saltMsg.set(salt);
  const u = new Uint8Array(32);
  const t = new Uint8Array(32);
  const blocks = Math.ceil(dkLen / 32);
  for (let block = 1; block <= blocks; block++) {
    saltMsg[salt.length] = (block >>> 24) & 0xff;
    saltMsg[salt.length + 1] = (block >>> 16) & 0xff;
    saltMsg[salt.length + 2] = (block >>> 8) & 0xff;
    saltMsg[salt.length + 3] = block & 0xff;
    hmacShort(inner, outer, saltMsg, u); // U_1 = PRF(P, S || INT(i))
    t.set(u);
    for (let i = 1; i < iterations; i++) {
      hmacShort(inner, outer, u, u); // U_j = PRF(P, U_{j-1})
      for (let k = 0; k < 32; k++) t[k] ^= u[k];
    }
    const copy = Math.min(32, dkLen - (block - 1) * 32);
    out.set(t.subarray(0, copy), (block - 1) * 32);
  }
  return out;
}

// ---------- PIN storage helpers ----------

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (g?.getRandomValues) {
    g.getRandomValues(b);
  } else {
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

const HEX = '0123456789abcdef';
function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
}
function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** True when the stored value is already a salted hash. */
export function isPinHash(v: string | undefined): boolean {
  return typeof v === 'string' && v.startsWith('pbkdf2-sha256$');
}

/** Legacy plaintext stored value — re-hash after the next successful check. */
export function pinNeedsUpgrade(stored: string | undefined): boolean {
  return !isPinHash(stored);
}

/** Hash a 4–8 digit PIN for storage. */
export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = pbkdf2Sha256(ascii(pin), salt, PBKDF2_ITERATIONS, KEYLEN);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(key)}`;
}

function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false; // length is not secret here
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function constantTimeEqualsStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check a PIN candidate against the stored value.
 * `undefined` (no PIN ever set) means the shipped default PIN.
 * Plaintext legacy rows compare as plaintext — callers upgrade on success.
 */
export function verifyPin(stored: string | undefined, pin: string): boolean {
  if (!stored) return constantTimeEqualsStr(DEFAULT_STAFF_PIN, pin);
  if (!isPinHash(stored)) return constantTimeEqualsStr(stored, pin);
  const parts = stored.split('$');
  if (parts.length !== 4) return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  const actual = pbkdf2Sha256(ascii(pin), salt, iterations, expected.length);
  return constantTimeEquals(expected, actual);
}
