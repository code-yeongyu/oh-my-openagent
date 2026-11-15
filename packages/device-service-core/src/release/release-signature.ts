import { spawnSync } from "node:child_process"
import { strictEd25519Key, strictEd25519Verify } from "../strict-ed25519/strict-ed25519.ts"
import committedReleaseKey from "./release-key.json"

const HEX_KEY = /^[0-9a-f]{64}$/

// release-key.json is a byte copy of the device service's own packages/relayd/release-key.json: the release key SET
// (an operational and a recovery key, verified any-of). Parsed by the same rules as the service's parseReleaseKey, so
// a file the service would refuse never becomes a different set here. A set that fails strictEd25519Key (the old
// all-zeros placeholder did) stops every acquisition with release_key_invalid before it downloads anything.
export const parseReleaseKeySet = (value: unknown): readonly string[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("release key: not an object")
  if (Object.keys(value).toSorted().join(",") !== "alg,public_keys_hex")
    throw new Error("release key: fields must be exactly alg and public_keys_hex")
  const alg: unknown = Reflect.get(value, "alg")
  const hexes: unknown = Reflect.get(value, "public_keys_hex")
  if (alg !== "Ed25519") throw new Error("release key: alg must be Ed25519")
  if (!Array.isArray(hexes)) throw new Error("release key: public_keys_hex must be an array")
  if (new Set(hexes).size !== hexes.length) throw new Error("release key: public_keys_hex must not repeat a key")
  return hexes.map((hex: unknown) => {
    if (typeof hex !== "string" || !HEX_KEY.test(hex))
      throw new Error("release key: each public_keys_hex entry must be 64 lowercase hex characters")
    return hex
  })
}

export const DEVICE_SERVICE_RELEASE_KEYS: readonly string[] = parseReleaseKeySet(committedReleaseKey)

export type SignatureVerdict =
  { readonly ok: true } | { readonly ok: false; readonly refusal: "malformed" | "signature" }

/**
 * The release check: every key of the set must pass strictEd25519Key, then the signature must pass
 * strictEd25519Verify over the exact checksums.txt bytes under any one of them. Nothing else decides, so inputs the
 * runtime's own verifier accepts (the identity point, S >= L) are refused here, and a set holding the placeholder
 * next to a real key is refused as a whole.
 */
export const verifyReleaseSignature = async (
  releaseKeys: readonly Uint8Array[],
  signature: Uint8Array,
  checksums: Uint8Array,
): Promise<SignatureVerdict> => {
  if (releaseKeys.length === 0 || !releaseKeys.every((key) => strictEd25519Key(key)))
    return { ok: false, refusal: "malformed" }
  let verdict: SignatureVerdict = { ok: false, refusal: "signature" }
  for (const key of releaseKeys) {
    verdict = await strictEd25519Verify(key, signature, checksums)
    if (verdict.ok || verdict.refusal === "malformed") return verdict
  }
  return verdict
}

/** The key set as bytes, or undefined when it is empty, repeats a key, or holds an entry that is not a strict key. */
export const releaseKeySetBytes = (hexes: readonly string[]): readonly Uint8Array[] | undefined => {
  if (hexes.length === 0 || new Set(hexes).size !== hexes.length || !hexes.every((hex) => HEX_KEY.test(hex)))
    return undefined
  const keys = hexes.map((hex) => new Uint8Array(Buffer.from(hex, "hex")))
  return keys.every((key) => strictEd25519Key(key)) ? keys : undefined
}

// The macOS signing identity every published release binary carries (codesign -dvv on the notarized darwin-arm64 and
// darwin-x64 builds: Identifier=ai.omo.device-service, TeamIdentifier=523JNR86LZ). An empty identifier refused every
// macOS install (#13229); the release-signature test fails the build if either field is ever left empty again.
export const DEVICE_SERVICE_SIGNING_IDENTITY = { identifier: "ai.omo.device-service", team: "523JNR86LZ" } as const

export const codeSignaturePasses = (path: string): boolean => {
  const { identifier, team } = DEVICE_SERVICE_SIGNING_IDENTITY
  const requirement =
    `identifier "${identifier}" and anchor apple generic and certificate leaf[subject.OU] = "${team}" ` +
    "and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
  const result = spawnSync("/usr/bin/codesign", ["--verify", "--strict", `-R=${requirement}`, path], {
    stdio: "ignore",
    timeout: 10_000,
  })
  return result.error === undefined && result.status === 0
}
