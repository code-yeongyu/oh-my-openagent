/**
 * Decision 0003: docs/decisions/0003-hello-pop-hardening.md (prime-key amendment).
 * Ed25519: canonical on-curve A/R, no negative zero or order-dividing-8 points;
 * public KEYS additionally require [L]A=identity (1024-entry byte-keyed LRU).
 * S<L; native WebCrypto computes the equation ONLY after strict prechecks.
 * The exported reference oracle computes the cofactorless equation in-helper.
 * Consumers MUST pass the full native/reference corpus on their runtime.
 * X25519: exactly 32 bytes, top bit clear, u<p, exclude all five low-order u;
 * the derived secret must be exactly 32 bytes and not all zero before any KDF.
 * Dependency-free and vendorable on Bun, Node, workerd. X25519 agreement stays
 * with the caller's backend. R need not pass the prime-order public-key check.
 * Variable-time group arithmetic handles public values only.
 */
export type StrictEd25519Verdict =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; refusal: "malformed" | "signature" }>;

const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const mod = (n: bigint): bigint => {
  const r = n % P;
  return r < 0n ? r + P : r;
};
const power = (base: bigint, exponent: bigint): bigint => {
  let result = 1n;
  let b = mod(base);
  for (let n = exponent; n > 0n; n >>= 1n) {
    if (n & 1n) result = mod(result * b);
    b = mod(b * b);
  }
  return result;
};
const D = mod(-121665n * power(121666n, P - 2n));
const SQRT_MINUS_ONE = power(2n, (P - 1n) / 4n);
const squareN = (x: bigint, n: number): bigint => {
  for (let i = 0; i < n; i++) x = mod(x * x);
  return x;
};
// Fixed addition chain for z^(2^252-3): 251 squares and 11 multiplies.
const sqrtPower = (z: bigint): bigint => {
  const z2 = mod(z * z);
  const z9 = mod(squareN(z2, 2) * z);
  let a = mod(squareN(mod(z2 * z9), 1) * z9); // 2^5-1
  a = mod(squareN(a, 5) * a); // 2^10-1
  let b = mod(squareN(a, 10) * a); // 2^20-1
  b = mod(squareN(b, 20) * b); // 2^40-1
  a = mod(squareN(b, 10) * a); // 2^50-1
  b = mod(squareN(a, 50) * a); // 2^100-1
  b = mod(squareN(b, 100) * b); // 2^200-1
  a = mod(squareN(b, 50) * a); // 2^250-1
  return mod(squareN(a, 2) * z);
};
type Point = Readonly<{ x: bigint; y: bigint; z: bigint; t: bigint }>;
const IDENTITY: Point = { x: 0n, y: 1n, z: 1n, t: 0n };
const BASE_X = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
const BASE_Y = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
const BASE: Point = { x: BASE_X, y: BASE_Y, z: 1n, t: mod(BASE_X * BASE_Y) };

// Complete extended twisted-Edwards addition for a=-1; XY=ZT and z is nonzero.
const add = (p: Point, q: Point): Point => {
  const a = mod((p.y - p.x) * (q.y - q.x));
  const b = mod((p.y + p.x) * (q.y + q.x));
  const c = mod(2n * D * p.t * q.t);
  const d = mod(2n * p.z * q.z);
  const e = b - a;
  const f = d - c;
  const g = d + c;
  const h = b + a;
  return { x: mod(e * f), y: mod(g * h), z: mod(f * g), t: mod(e * h) };
};
const multiply = (point: Point, scalar: bigint): Point => {
  let result = IDENTITY;
  let p = point;
  for (let n = scalar; n > 0n; n >>= 1n) {
    if (n & 1n) result = add(result, p);
    p = add(p, p);
  }
  return result;
};
const equal = (p: Point, q: Point): boolean =>
  mod(p.x * q.z - q.x * p.z) === 0n && mod(p.y * q.z - q.y * p.z) === 0n;
const littleEndian = (bytes: Uint8Array): bigint => {
  let n = 0n;
  for (const b of Array.from(bytes).reverse()) n = (n << 8n) | BigInt(b);
  return n;
};
const decodePoint = (bytes: Uint8Array): Point | undefined => {
  if (bytes.length !== 32) return undefined;
  const encoded = littleEndian(bytes);
  const sign = encoded >> 255n;
  const y = encoded & ((1n << 255n) - 1n);
  if (y >= P) return undefined;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  // RFC 8032 square-root ratio: one exponentiation, without a separate inverse.
  const v3 = mod(v * v * v);
  const v7 = mod(v3 * v3 * v);
  let x = mod(u * v3 * sqrtPower(mod(u * v7)));
  if (mod(v * x * x) === mod(-u)) x = mod(x * SQRT_MINUS_ONE);
  if (mod(v * x * x) !== u) return undefined;
  if (x === 0n && sign === 1n) return undefined;
  if ((x & 1n) !== sign) x = mod(-x);
  const point: Point = { x, y, z: 1n, t: mod(x * y) };
  if (equal(multiply(point, 8n), IDENTITY)) return undefined;
  return point;
};

// Cache immutable byte values, never caller-owned arrays. Map order is LRU order.
const KEY_CACHE_LIMIT = 1024;
type CachedKey = { readonly point: Point | false; native?: Promise<CryptoKey> };
const keyCache = new Map<string, CachedKey>();
const cachedPublicKey = (key: Uint8Array): CachedKey => {
  const encoded = Array.from(key, (b) => b.toString(16).padStart(2, "0")).join("");
  const cached = keyCache.get(encoded);
  if (cached !== undefined) {
    keyCache.delete(encoded);
    keyCache.set(encoded, cached);
    return cached;
  }
  const point = decodePublicKeyUncached(key);
  if (keyCache.size === KEY_CACHE_LIMIT) {
    const oldest = keyCache.keys().next().value;
    if (oldest !== undefined) keyCache.delete(oldest);
  }
  const entry: CachedKey = { point: point ?? false };
  keyCache.set(encoded, entry);
  return entry;
};
const decodePublicKey = (key: Uint8Array): Point | undefined => {
  if (key.length !== 32) return undefined;
  const point = cachedPublicKey(key).point;
  return point === false ? undefined : point;
};
const decodePublicKeyUncached = (key: Uint8Array): Point | undefined => {
  const point = decodePoint(key);
  if (point === undefined || !equal(multiply(point, L), IDENTITY)) return undefined;
  return point;
};

/** Registration and verification share canonical, nonidentity prime-order key checks. */
export const strictEd25519Key = (key: Uint8Array): boolean => decodePublicKey(key) !== undefined;

/**
 * Not a signature verdict: follow with a corpus-qualified native verifier on the exact
 * same key/signature bytes and intended message snapshot; never mutate/substitute them.
 */
export const strictEd25519Precheck = (key: Uint8Array, sig: Uint8Array):
  Readonly<{ ok: true }> | Readonly<{ ok: false; refusal: "malformed" }> => {
  if (key.length !== 32 || sig.length !== 64) return { ok: false, refusal: "malformed" };
  if (decodePublicKey(key) === undefined || decodePoint(sig.subarray(0, 32)) === undefined
    || littleEndian(sig.subarray(32)) >= L) return { ok: false, refusal: "malformed" };
  return { ok: true };
};

export const strictEd25519Verify = async (key: Uint8Array, sig: Uint8Array, msg: Uint8Array): Promise<StrictEd25519Verdict> => {
  const checked = strictEd25519Precheck(key, sig);
  if (!checked.ok) return checked;
  // Snapshot before importKey yields; caller buffer reuse cannot change checked bytes.
  const aBytes = Uint8Array.from(key);
  const signature = Uint8Array.from(sig);
  const message = Uint8Array.from(msg);
  const cached = cachedPublicKey(aBytes);
  if (cached.point === false) throw new Error("prechecked Ed25519 key lost its validated point");
  cached.native ??= crypto.subtle.importKey("raw", aBytes, "Ed25519", false, ["verify"]).catch((error: unknown) => {
    delete cached.native;
    throw error;
  });
  const nativeKey = await cached.native;
  const valid = await crypto.subtle.verify("Ed25519", nativeKey, signature, message);
  return valid ? { ok: true } : { ok: false, refusal: "signature" };
};

/** Slow, independent equation oracle for corpus parity; not the shipped hot path. */
export const strictEd25519VerifyReference = async (key: Uint8Array, sig: Uint8Array, msg: Uint8Array): Promise<StrictEd25519Verdict> => {
  if (key.length !== 32 || sig.length !== 64) return { ok: false, refusal: "malformed" };
  // Snapshot the public inputs before the first await; callers may reuse their buffers.
  const aBytes = Uint8Array.from(key);
  const signature = Uint8Array.from(sig);
  const a = decodePublicKeyUncached(aBytes);
  const r = decodePoint(signature.subarray(0, 32));
  const s = littleEndian(signature.subarray(32));
  if (a === undefined || r === undefined || s >= L) return { ok: false, refusal: "malformed" };
  const hashInput = new Uint8Array(64 + msg.length);
  hashInput.set(signature.subarray(0, 32));
  hashInput.set(aBytes, 32);
  hashInput.set(msg, 64);
  const h = littleEndian(new Uint8Array(await crypto.subtle.digest("SHA-512", hashInput))) % L;
  return equal(multiply(BASE, s), add(r, multiply(a, h)))
    ? { ok: true } : { ok: false, refusal: "signature" };
};

// Montgomery u-coordinates of the order-8 points (little-endian encodings in the corpus).
const X25519_ORDER8 = [325606250916557431795983626356110631294008115727848805560023387167927233504n, 39382357235489614581723060781553021112529911719440698176882885853963445705823n] as const;

/** Strict registration policy, not RFC 7748's permissive masking/reduction of received u. */
export const strictX25519Key = (key: Uint8Array): boolean => {
  if (key.length !== 32) return false;
  const u = littleEndian(key);
  if (u >> 255n || u >= P) return false;
  return u !== 0n && u !== 1n && u !== P - 1n && u !== X25519_ORDER8[0] && u !== X25519_ORDER8[1];
};

/** Call after native X25519 derivation and before KDF; never use a refused secret. */
export const checkSharedSecret = (secret: Uint8Array): boolean => {
  if (secret.length !== 32) return false;
  let nonzero = 0;
  for (const byte of secret) nonzero |= byte;
  return nonzero !== 0;
};
