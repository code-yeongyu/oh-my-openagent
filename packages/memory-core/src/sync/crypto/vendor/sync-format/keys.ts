/**
 * Ed25519 key plumbing over WebCrypto (pkcs8 seeds, spki public keys), the protocol's framed
 * signatures (`context || 0x00 || canonical JSON payload`), HKDF-SHA-256 and the device-id
 * derivation of docs/sync-design.md section 7. No runtime dependency; the same code runs in Bun,
 * workerd, Node and Electron.
 */
import {
  asciiBytes,
  b64urlDecode,
  b64urlEncode,
  concatBytes,
  type JsonValue,
  jcsBytes,
  sha256,
} from "./jcs.ts";

const hexBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  const pairs = hex.match(/../g);
  return Uint8Array.from((pairs ?? []).map((pair) => Number.parseInt(pair, 16)));
};

const ED25519_PKCS8_PREFIX = hexBytes("302e020100300506032b657004220420");
const ED25519_SPKI_PREFIX = hexBytes("302a300506032b6570032100");

const importSigningSeed = (seed: Uint8Array<ArrayBuffer>): Promise<CryptoKey> =>
  crypto.subtle.importKey("pkcs8", concatBytes([ED25519_PKCS8_PREFIX, seed]), "Ed25519", true, [
    "sign",
  ]);

const importVerifyKey = (publicKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> =>
  crypto.subtle.importKey("spki", concatBytes([ED25519_SPKI_PREFIX, publicKey]), "Ed25519", false, [
    "verify",
  ]);

/** The raw 32-byte public key of a signing seed, derived through its JWK `x`. */
export const ed25519PublicKey = async (
  seed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> => {
  const key = await importSigningSeed(seed);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  const x = typeof jwk.x === "string" ? jwk.x : "";
  return b64urlDecode(x);
};

const frameBytes = (context: string, payload: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> =>
  concatBytes([asciiBytes(context), Uint8Array.from([0]), payload]);

/** The bytes a framed signature covers: ASCII context, one NUL, canonical JSON payload. */
export const framedPreimage = (context: string, payload: JsonValue): Uint8Array<ArrayBuffer> =>
  frameBytes(context, jcsBytes(payload));

/** Ed25519-signs the framed payload with the seed; returns unpadded base64url (64 bytes). */
export const signFramed = async (
  context: string,
  payload: JsonValue,
  seed: Uint8Array<ArrayBuffer>,
): Promise<string> => {
  const key = await importSigningSeed(seed);
  const signature = await crypto.subtle.sign("Ed25519", key, framedPreimage(context, payload));
  return b64urlEncode(new Uint8Array(signature));
};

/** Verifies a framed Ed25519 signature; any import or verification failure reads as false. */
export const verifyFramed = async (
  context: string,
  payload: JsonValue,
  publicKey: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> => {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await importVerifyKey(publicKey);
    return await crypto.subtle.verify("Ed25519", key, signature, framedPreimage(context, payload));
  } catch {
    return false;
  }
};

/**
 * Verifies a framed signature over raw payload bytes (the object-digest purpose signs the raw
 * SHA-256 of the unsigned object, not a JSON payload).
 */
export const verifyFramedBytes = async (
  context: string,
  payload: Uint8Array<ArrayBuffer>,
  publicKey: Uint8Array<ArrayBuffer>,
  signature: Uint8Array<ArrayBuffer>,
): Promise<boolean> => {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await importVerifyKey(publicKey);
    return await crypto.subtle.verify("Ed25519", key, signature, frameBytes(context, payload));
  } catch {
    return false;
  }
};

/** HKDF-SHA-256 (RFC 5869 through WebCrypto) at 32 bytes, the protocol's one KDF shape. */
export const hkdfSha256 = async (
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    256,
  );
  return new Uint8Array(bits);
};

/**
 * A device id: the first 16 bytes of SHA-256("omo-sync/v1/device-id" || 0x00 || signing public
 * key), base64url. Every record that names a device carries its full keys, so receivers recompute.
 */
export const deriveDeviceId = async (signingSeed: Uint8Array<ArrayBuffer>): Promise<string> => {
  const publicKey = await ed25519PublicKey(signingSeed);
  const digest = await sha256(
    concatBytes([asciiBytes("omo-sync/v1/device-id"), Uint8Array.from([0]), publicKey]),
  );
  return b64urlEncode(digest.subarray(0, 16));
};
