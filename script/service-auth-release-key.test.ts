import { describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { join } from "node:path"
import committedReleaseKey from "../packages/device-service-core/src/release/release-key.json"
import { assertReleaseKeySet } from "./service-auth-release-key"

const PLACEHOLDER = "00".repeat(32)

const bundleCarrying = (...keys: readonly string[]): string =>
  `var releaseKeys={alg:"Ed25519",public_keys_hex:[${keys.map(key => `"${key}"`).join(",")}]};`

// A fresh keypair per run: the guard checks the shape of the bytes, and no test may carry a service key.
const syntheticKey = async (): Promise<string> => {
  const pair = generateKeyPairSync("ed25519")
  const der = pair.publicKey.export({ format: "der", type: "spki" })
  const imported = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, true, ["verify"])
  return Buffer.from(await crypto.subtle.exportKey("raw", imported)).toString("hex")
}

describe("the release step refuses a service-auth bundle it cannot verify", () => {
  test("#given a bundle carrying the all-zero placeholder #when the bundle is asserted #then the release step fails", () => {
    expect(() => assertReleaseKeySet(bundleCarrying(PLACEHOLDER))).toThrow()
  })

  test("#given a bundle carrying a strict key next to the all-zero placeholder #when the bundle is asserted #then the release step fails", async () => {
    const key = await syntheticKey()

    expect(() => assertReleaseKeySet(bundleCarrying(key, PLACEHOLDER))).toThrow()
  })

  test("#given a bundle carrying a synthetic strict ed25519 key #when the bundle is asserted #then the key set is accepted", async () => {
    const key = await syntheticKey()

    expect(assertReleaseKeySet(bundleCarrying(key))).toEqual([key])
  })

  test("#given a bundle with no release key set at all #when the bundle is asserted #then the release step fails instead of passing silently", () => {
    expect(() => assertReleaseKeySet("var unrelated=1")).toThrow()
  })

  test("#given the committed service-auth bundle #when it is asserted #then it carries exactly the committed release key set", async () => {
    const bundle = await Bun.file(join(import.meta.dir, "../packages/omo-native/bin/lib/service-auth.generated.js")).text()

    expect(assertReleaseKeySet(bundle)).toEqual(committedReleaseKey.public_keys_hex)
  })
})
