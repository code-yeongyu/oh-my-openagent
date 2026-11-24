import { createHash } from "node:crypto"
import { strictEd25519Key, strictEd25519Verify } from "./strict-ed25519.ts"

// #14916. The minisign wire format, frozen and pinned empirically against stock minisign 0.11 (the probe receipts
// live with the PR evidence): a public key file is `untrusted comment: <text>` + base64("Ed" || keyid(8) || pk(32));
// a signature file is `untrusted comment: <text>` + base64(algo || keyid(8) || sig(64)) + `trusted comment: <text>`
// + base64(Ed25519(sk, sig64raw || trustedText)). The "ED" algorithm signs the BLAKE2b-512 digest of the file.
// R1 (keyring delta read): "ED" only. A valid "Ed" (raw, un-prehashed) signature is refused by every verifier,
// as are wrong algorithm ids, wrong key-id lengths, wrong decoded lengths and any extra line.
const PUB_ALGO = "Ed"
export const MINISIGN_SIG_ALGO_ED = "ED"
export const MINISIGN_PUB_DECODED_BYTES = 42
export const MINISIGN_SIG_DECODED_BYTES = 74
const BASE64_STRICT = /^[A-Za-z0-9+/]+={0,2}$/
const UNTRUSTED_PREFIX = "untrusted comment: "
const TRUSTED_PREFIX = "trusted comment: "

export type MinisignRefusal = "malformed" | "algorithm" | "wrong_length"
export type MinisignPublicKey = Readonly<{ keyid: Uint8Array; pk: Uint8Array }>
export type MinisignSignature = Readonly<{ keyid: Uint8Array; sig: Uint8Array }>
export type SignatureVerdict =
  | { readonly ok: true }
  | { readonly ok: false; refusal: "malformed" | "algorithm" | "wrong_length" | "signature" }

export type ParseVerdict<T> = { readonly ok: true; value: T } | { readonly ok: false; refusal: MinisignRefusal; reason: string }

const decodeB64Line = (line: string, expectedBytes: number): Uint8Array | null => {
  if (line.length === 0 || !BASE64_STRICT.test(line)) return null
  const decoded = Buffer.from(line, "base64")
  if (decoded.length !== expectedBytes || Buffer.from(decoded.toString("base64"), "base64").length !== expectedBytes) return null
  if (b64Of(decoded) !== line) return null
  return new Uint8Array(decoded)
}

const b64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64")

const splitLines = (text: string, count: number): string[] | null => {
  if (text.includes("\r")) return null
  if (!text.endsWith("\n")) return null
  const lines = text.slice(0, -1).split("\n")
  return lines.length === count ? lines : null
}

/** Parses a minisign public key file: exactly two lines, 42 decoded bytes, algorithm "Ed". */
export const parseMinisignPublicKey = (text: string): ParseVerdict<MinisignPublicKey> => {
  const lines = splitLines(text, 2)
  if (lines === null) return { ok: false, refusal: "malformed", reason: "public key file must be exactly two LF-terminated lines" }
  if (!lines[0].startsWith(UNTRUSTED_PREFIX)) return { ok: false, refusal: "malformed", reason: "first line must start with 'untrusted comment: '" }
  const decoded = decodeB64Line(lines[1], MINISIGN_PUB_DECODED_BYTES)
  if (decoded === null) return { ok: false, refusal: "wrong_length", reason: "public key line must be base64 for exactly 42 bytes" }
  if (decoded[0] !== 0x45 || decoded[1] !== 0x64) return { ok: false, refusal: "algorithm", reason: "public key algorithm must be 'Ed'" }
  const keyid = decoded.slice(2, 10)
  const pk = decoded.slice(10)
  if (!strictEd25519Key(pk)) return { ok: false, refusal: "malformed", reason: "public key is not a strict Ed25519 key" }
  return { ok: true, value: { keyid, pk } }
}

/** Parses a minisign signature file: exactly four lines; the global block must be "ED" with 8-byte key id and 64-byte signature. */
export const parseMinisignSignature = (text: string): ParseVerdict<MinisignSignature> => {
  const lines = splitLines(text, 4)
  if (lines === null) return { ok: false, refusal: "malformed", reason: "signature file must be exactly four LF-terminated lines" }
  if (!lines[0].startsWith(UNTRUSTED_PREFIX)) return { ok: false, refusal: "malformed", reason: "first line must start with 'untrusted comment: '" }
  if (!lines[2].startsWith(TRUSTED_PREFIX)) return { ok: false, refusal: "malformed", reason: "third line must start with 'trusted comment: '" }
  const decoded = decodeB64Line(lines[1], MINISIGN_SIG_DECODED_BYTES)
  if (decoded === null) return { ok: false, refusal: "wrong_length", reason: "signature line must be base64 for exactly 74 bytes" }
  const algo = String.fromCharCode(decoded[0], decoded[1])
  if (algo === "Ed") return { ok: false, refusal: "algorithm", reason: "un-prehashed 'Ed' signatures are refused (algorithm frozen to 'ED')" }
  if (algo !== MINISIGN_SIG_ALGO_ED) return { ok: false, refusal: "algorithm", reason: "signature algorithm must be 'ED'" }
  const commentSig = decodeB64Line(lines[3], 64)
  if (commentSig === null) return { ok: false, refusal: "wrong_length", reason: "trusted-comment signature must be base64 for exactly 64 bytes" }
  return { ok: true, value: { keyid: decoded.slice(2, 10), sig: decoded.slice(10) } }
}

const blake2b512 = (message: Uint8Array): Uint8Array => new Uint8Array(createHash("blake2b512").update(message).digest())

/**
 * The release check: the "ED" global signature must verify under any one pinned key over the BLAKE2b-512 digest of
 * the signed file's exact bytes. Nothing else decides: comment lines are display text here (they exist for stock
 * minisign users), and inputs the runtime's own verifier would accept (non-canonical S, small-order A) are refused
 * by the vendored strict verifier. A malformed signature is malformed under every key, so it short-circuits.
 */
export const verifyMinisignEd = async (
  keys: readonly Uint8Array[],
  signatureFile: Uint8Array,
  message: Uint8Array,
): Promise<SignatureVerdict> => {
  const parsed = parseMinisignSignature(Buffer.from(signatureFile).toString("utf8"))
  if (!parsed.ok) return { ok: false, refusal: parsed.refusal }
  if (keys.length === 0 || !keys.every((key) => strictEd25519Key(key))) return { ok: false, refusal: "malformed" }
  const digest = blake2b512(message)
  let verdict: SignatureVerdict = { ok: false, refusal: "signature" }
  for (const key of keys) {
    // The key id must name the key that verifies, as upstream minisign does: a valid signature under a pinned key
    // whose id line says a different key is refused instead of silently accepted.
    if (!Buffer.from(minisignKeyidOf(key)).equals(Buffer.from(parsed.value.keyid))) continue
    verdict = await strictEd25519Verify(key, parsed.value.sig, digest)
    if (verdict.ok || (verdict.ok === false && verdict.refusal === "malformed")) return verdict
  }
  return verdict
}

/** The keyid convention upstream minisign uses for generated keys; kept identical for third-party familiarity. */
export const minisignKeyidOf = (pk: Uint8Array): Uint8Array => blake2b512(pk).slice(0, 8)
