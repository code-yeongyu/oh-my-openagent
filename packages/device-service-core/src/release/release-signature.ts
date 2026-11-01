import { spawnSync } from "node:child_process"
import { strictEd25519Key, strictEd25519Verify } from "../strict-ed25519/strict-ed25519.ts"

// The public key that signs device service releases, as 64 hex characters. Until the release key is published this is
// the all-zeros value, which strictEd25519Key refuses, so every acquisition stops with release_key_invalid before it
// downloads anything.
export const DEVICE_SERVICE_RELEASE_KEY = "00".repeat(32)

export type SignatureVerdict = { readonly ok: true } | { readonly ok: false; readonly refusal: "malformed" | "signature" }

/**
 * The release check: the key must pass strictEd25519Key, then the signature must pass strictEd25519Verify over the
 * exact checksums.txt bytes. Nothing else decides, so inputs the runtime's own verifier accepts (the identity point,
 * S >= L) are refused here.
 */
export const verifyReleaseSignature = async (releaseKey: Uint8Array, signature: Uint8Array, checksums: Uint8Array): Promise<SignatureVerdict> => {
  if (!strictEd25519Key(releaseKey)) return { ok: false, refusal: "malformed" }
  return strictEd25519Verify(releaseKey, signature, checksums)
}

export const releaseKeyBytes = (hex: string): Uint8Array | undefined =>
  /^[0-9a-f]{64}$/.test(hex) ? new Uint8Array(Buffer.from(hex, "hex")) : undefined

// The macOS signing identity of the release binary. The identifier is not published yet, so no binary passes until it is.
const SIGNING_IDENTIFIER = ""
const SIGNING_TEAM = "523JNR86LZ"

export const codeSignaturePasses = (path: string): boolean => {
  if (SIGNING_IDENTIFIER === "") return false
  const requirement =
    `identifier "${SIGNING_IDENTIFIER}" and anchor apple generic and certificate leaf[subject.OU] = "${SIGNING_TEAM}" ` +
    "and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
  const result = spawnSync("/usr/bin/codesign", ["--verify", "--strict", `-R=${requirement}`, path], { stdio: "ignore", timeout: 10_000 })
  return result.error === undefined && result.status === 0
}
