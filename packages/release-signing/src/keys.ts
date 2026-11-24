import committed from "../keys/release-keys.json"
import { strictEd25519Key } from "./strict-ed25519.ts"

// #14916 custody model: the pinned CLI release key set and the V_sign cut-over constant live in ONE committed file,
// `keys/release-keys.json`, shaped like the device service's release-key set (strictly parsed; a file the verifier
// would refuse never becomes the live set). The LEAD commits the real public keys together with the V_sign value in
// the same change that starts signing releases (H1: sign BEFORE the verifier ships). Until then the set is empty and
// V_sign is null: release signing is INACTIVE, verifiers verify when a signature is present and otherwise behave
// exactly like today. An empty set with a non-null V_sign, or keys without V_sign, is a custody inconsistency and
// refuses to parse — it can never silently ship a half-configured verifier.
const HEX_KEY = /^[0-9a-f]{64}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/

type ReleaseKeysFile = { readonly alg: "Ed25519"; readonly public_keys_hex: readonly string[]; readonly v_sign: string | null }

const parseReleaseKeysFile = (value: unknown): ReleaseKeysFile => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("release keys: not an object")
  if (Object.keys(value).toSorted().join(",") !== "alg,public_keys_hex,v_sign")
    throw new Error("release keys: fields must be exactly alg, public_keys_hex and v_sign")
  const alg: unknown = Reflect.get(value, "alg")
  const hexes: unknown = Reflect.get(value, "public_keys_hex")
  const vSign: unknown = Reflect.get(value, "v_sign")
  if (alg !== "Ed25519") throw new Error("release keys: alg must be Ed25519")
  if (!Array.isArray(hexes)) throw new Error("release keys: public_keys_hex must be an array")
  if (vSign !== null && (typeof vSign !== "string" || !VERSION_RE.test(vSign)))
    throw new Error("release keys: v_sign must be null or a full release version")
  const keys = hexes.map((hex: unknown) => {
    if (typeof hex !== "string" || !HEX_KEY.test(hex))
      throw new Error("release keys: each public_keys_hex entry must be 64 lowercase hex characters")
    return hex
  })
  if (new Set(keys).size !== keys.length) throw new Error("release keys: public_keys_hex must not repeat a key")
  if (keys.length === 0 && vSign !== null) throw new Error("release keys: v_sign set without any pinned key")
  if (keys.length > 0 && vSign === null) throw new Error("release keys: pinned keys without a v_sign cut-over")
  return { alg, public_keys_hex: keys, v_sign: (vSign as string | null) ?? null }
}

const parsed = parseReleaseKeysFile(committed)

export const RELEASE_SIGNING_PUBLIC_KEYS_HEX: readonly string[] = parsed.public_keys_hex
export const RELEASE_SIGNING_V_SIGN: string | null = parsed.v_sign
export const RELEASE_SIGNING_ACTIVE = parsed.public_keys_hex.length > 0

/** The pinned set as raw key bytes, or an empty array while signing is inactive. */
export const releaseSigningKeyBytes = (): readonly Uint8Array[] =>
  RELEASE_SIGNING_PUBLIC_KEYS_HEX.map((hex) => new Uint8Array(Buffer.from(hex, "hex")))

if (RELEASE_SIGNING_ACTIVE && !releaseSigningKeyBytes().every((key) => strictEd25519Key(key)))
  throw new Error("release keys: a pinned key is not a strict Ed25519 public key")
