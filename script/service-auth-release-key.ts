import { releaseKeySetBytes } from "../packages/device-service-core/src/release/release-signature"

const RELEASE_KEY_SET = /["']?public_keys_hex["']?\s*:\s*\[([^\]]*)\]/
const KEY_ENTRY = /^\s*"[0-9a-f]{64}"\s*$/

const releaseKeysInBundle = (bundle: string): readonly string[] => {
  const set = RELEASE_KEY_SET.exec(bundle)
  if (set === null) throw new Error("the service-auth bundle does not carry a public_keys_hex release key set")
  const entries = (set[1] ?? "").split(",").filter(entry => entry.trim() !== "")
  if (!entries.every(entry => KEY_ENTRY.test(entry)))
    throw new Error("the service-auth bundle's release key set holds an entry that is not 64 lowercase hex characters")
  return entries.map(entry => entry.trim().slice(1, -1))
}

export const assertReleaseKeySet = (bundle: string): readonly string[] => {
  const keys = releaseKeysInBundle(bundle)
  if (releaseKeySetBytes(keys) === undefined)
    throw new Error(
      "the service-auth bundle carries a release key set the device service refuses (the all-zero placeholder is not a strict ed25519 key); fix packages/device-service-core/src/release/release-key.json",
    )
  return keys
}
