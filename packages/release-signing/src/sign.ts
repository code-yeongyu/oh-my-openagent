import { createHash, createPrivateKey, createPublicKey, sign as edSign } from "node:crypto"
import { minisignKeyidOf, MINISIGN_SIG_ALGO_ED } from "./minisign.ts"

// #14916 release signer, used ONLY by the release job's signing step (script/installer/release-sign.ts). The seed
// never appears in a log, an artifact or the repo: it arrives as a process environment value read by the workflow.
// The signer refuses to produce output when its derived public key is not in the pinned set (when the set is
// active), so an un-pinned key cannot sign a release even by operator mistake.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex")
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

export const publicKeyOfSeed = (seed: Uint8Array): Uint8Array => {
  if (seed.length !== 32) throw new Error("signing seed must be exactly 32 bytes")
  const pk = createPublicKey(createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]), format: "der", type: "pkcs8" }))
  const der = pk.export({ format: "der", type: "spki" })
  return new Uint8Array(der.subarray(der.length - 32))
}

const ed25519Sign = (seed: Uint8Array, message: Uint8Array): Uint8Array =>
  new Uint8Array(edSign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]), format: "der", type: "pkcs8" })))

const blake2b512 = (message: Uint8Array): Uint8Array => new Uint8Array(createHash("blake2b512").update(message).digest())

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64")

export const buildMinisignPublicKeyFile = (seed: Uint8Array): string => {
  const pk = publicKeyOfSeed(seed)
  return `untrusted comment: minisign public key\n${b64(Buffer.concat([Buffer.from("Ed", "latin1"), minisignKeyidOf(pk), pk]))}\n`
}

/**
 * Produces the SHA256SUMS.sig contents: a stock-minisign-compatible "ED" signature over the exact message bytes,
 * with the trusted comment signed the way upstream verify.c checks it (raw 64-byte global signature, then the
 * trusted comment text). `pinnedKeys` gates the seed: when it is non-empty, the seed's public key must be in it.
 */
export const signMinisignEd = (seed: Uint8Array, message: Uint8Array, trustedComment: string, pinnedKeys: readonly Uint8Array[] = []): Uint8Array => {
  const pk = publicKeyOfSeed(seed)
  if (pinnedKeys.length > 0 && !pinnedKeys.some((key) => Buffer.from(key).equals(Buffer.from(pk))))
    throw new Error("signing seed's public key is not in the pinned release key set")
  const globalSig = ed25519Sign(seed, blake2b512(message))
  const commentSig = ed25519Sign(seed, Buffer.concat([globalSig, Buffer.from(trustedComment, "utf8")]))
  const keyid = minisignKeyidOf(pk)
  const sigLine = b64(Buffer.concat([Buffer.from(MINISIGN_SIG_ALGO_ED, "latin1"), keyid, globalSig]))
  return new TextEncoder().encode(`untrusted comment: minisign signature\n${sigLine}\ntrusted comment: ${trustedComment}\n${b64(commentSig)}\n`)
}
