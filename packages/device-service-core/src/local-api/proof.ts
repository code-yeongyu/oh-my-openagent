// Vendored from sisyphuslabs/omo-relay-daemon@4ed58920002306a95bf92fe99ca448be89d7103f packages/local-api/src/proof.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fromBase64url, toBase64url } from "./bytes-encoding.ts";
import { LocalApiError } from "./errors.ts";

// The proof half of the access contract (docs/local-api.md "Access"), apart from the token file: nonces, ids and the
// HMAC-SHA256 proofs both sides exchange. It touches no file, so the browser device runtime's in-process connection runs
// it too (omo-relay-spec decision 0021 section 3.4).
export const NONCE_BYTES = 32;

export const mintNonce = (): string => toBase64url(randomBytes(NONCE_BYTES));
export const mintId = (): string => toBase64url(randomBytes(16));

/** Exactly `bytes` bytes in canonical unpadded base64url; anything else is a protocol violation. */
export const decodedBytes = (value: string, bytes: number, what: string): Uint8Array => {
  const violation = () =>
    new LocalApiError("protocol_violation", `${what} is not ${bytes} base64url bytes`);
  let out: Uint8Array;
  try {
    out = fromBase64url(value);
  } catch (error) {
    if (error instanceof Error) throw violation();
    throw error;
  }
  if (out.length !== bytes || toBase64url(out) !== value) throw violation();
  return out;
};

// HMAC-SHA256(token, label || nonce (32 raw bytes) || UTF-8 endpoint); the label and nonce are fixed-length.
const proof = (
  token: Uint8Array,
  label: "server" | "client",
  nonce: string,
  endpoint: string,
): string =>
  toBase64url(
    createHmac("sha256", token)
      .update(label)
      .update(decodedBytes(nonce, NONCE_BYTES, "a nonce"))
      .update(endpoint)
      .digest(),
  );
export const serverProof = (token: Uint8Array, clientNonce: string, endpoint: string): string =>
  proof(token, "server", clientNonce, endpoint);
export const clientProof = (token: Uint8Array, serverNonce: string, endpoint: string): string =>
  proof(token, "client", serverNonce, endpoint);
export const proofMatches = (expected: string, actual: string): boolean => {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(actual);
  return a.length === b.length && timingSafeEqual(a, b);
};
