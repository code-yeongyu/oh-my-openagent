import { describe, expect, test } from "bun:test"
import { generateKeyPairSync } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import committedReleaseKey from "../packages/device-service-core/src/release/release-key.json"
import { assertReleaseKeySet } from "./service-auth-release-key"

const PLACEHOLDER = "00".repeat(32)
const MISSING = "does not carry a public_keys_hex release key set"
const MALFORMED = "holds an entry that is not 64 lowercase hex characters"
const REFUSED = "carries a release key set the device service refuses"

const bundleCarrying = (...keys: readonly string[]): string =>
  `var releaseKeys={alg:"Ed25519",public_keys_hex:[${keys.map((key) => `"${key}"`).join(",")}]};`

// A fresh keypair per run: the guard checks the shape of the bytes, and no test may carry a service key.
const syntheticKey = async (): Promise<string> => {
  const pair = generateKeyPairSync("ed25519")
  const der = pair.publicKey.export({ format: "der", type: "spki" })
  const imported = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, true, ["verify"])
  return Buffer.from(await crypto.subtle.exportKey("raw", imported)).toString("hex")
}

describe("the release step refuses a service-auth bundle it cannot verify", () => {
  test("#given a bundle carrying the all-zero placeholder #when the bundle is asserted #then the release step fails", () => {
    expect(() => assertReleaseKeySet(bundleCarrying(PLACEHOLDER))).toThrow(REFUSED)
  })

  test("#given a bundle carrying a strict key next to the all-zero placeholder #when the bundle is asserted #then the release step fails", async () => {
    const key = await syntheticKey()

    expect(() => assertReleaseKeySet(bundleCarrying(key, PLACEHOLDER))).toThrow(REFUSED)
  })

  test("#given a bundle carrying a synthetic strict ed25519 key #when the bundle is asserted #then the key set is accepted", async () => {
    const key = await syntheticKey()

    expect(assertReleaseKeySet(bundleCarrying(key))).toEqual([key])
  })

  test("#given a bundle with no release key set at all #when the bundle is asserted #then the release step fails instead of passing silently", () => {
    expect(() => assertReleaseKeySet("var unrelated=1")).toThrow(MISSING)
  })

  test("#given a bundle carrying the same strict key twice #when the bundle is asserted #then the release step fails", async () => {
    const key = await syntheticKey()

    expect(() => assertReleaseKeySet(bundleCarrying(key, key))).toThrow(REFUSED)
  })

  test("#given a bundle whose key set is empty #when the bundle is asserted #then the release step fails", () => {
    expect(() => assertReleaseKeySet(bundleCarrying())).toThrow(REFUSED)
  })

  test("#given a bundle whose key set holds an entry that is not 64 lowercase hex characters #when the bundle is asserted #then the release step fails on that entry", async () => {
    const key = await syntheticKey()

    for (const malformed of [key.toUpperCase(), key.slice(2), `${key}00`, "not-a-key"])
      expect(() => assertReleaseKeySet(bundleCarrying(key, malformed))).toThrow(MALFORMED)
  })

  test("#given a bundle with a valid-looking key set literal ahead of the one it ships #when the bundle is asserted #then the release step fails instead of checking only the first", async () => {
    const key = await syntheticKey()
    const bundle = `var decoy={public_keys_hex:["${key}"]};${bundleCarrying(PLACEHOLDER)}`

    expect(() => assertReleaseKeySet(bundle)).toThrow("carries 2 public_keys_hex literals")
  })

  test("#given the committed service-auth bundle #when it is asserted #then it carries exactly the committed release key set", async () => {
    const bundle = await Bun.file(
      join(import.meta.dir, "../packages/omo-native/bin/lib/service-auth.generated.js"),
    ).text()

    expect(assertReleaseKeySet(bundle)).toEqual(committedReleaseKey.public_keys_hex)
  })

  test("the generated native entry imports with structurally malformed compiled key documents", async () => {
    const bundle = await Bun.file(
      join(import.meta.dir, "../packages/omo-native/bin/lib/service-auth.generated.js"),
    ).text()
    const documents = [...bundle.matchAll(/\{alg:"Ed25519",public_keys_hex:\[[^\]]*\]\}/g)]
    expect(documents).toHaveLength(1)
    const document = documents[0]?.[0]
    if (document === undefined) throw new Error("compiled key document missing")
    const root = mkdtempSync(join(tmpdir(), "release-key-entry-"))
    try {
      for (const fixture of [
        committedReleaseKey,
        { ...committedReleaseKey, unexpected: true },
        { ...committedReleaseKey, alg: "Ed448" },
        { ...committedReleaseKey, public_keys_hex: ["AB".repeat(32)] },
        { ...committedReleaseKey, public_keys_hex: ["ab".repeat(32), "ab".repeat(32)] },
      ]) {
        const entry = join(root, "entry.mjs")
        await Bun.write(entry, bundle.replace(document, JSON.stringify(fixture)))
        const child = Bun.spawnSync(
          [
            process.execPath,
            "--eval",
            `
          const native = await import(${JSON.stringify(pathToFileURL(entry).href)})
          console.log(typeof native.runRemoteCommand)
        `,
          ],
          { timeout: 20_000 },
        )
        expect(child.exitCode, child.stderr.toString()).toBe(0)
        expect(child.stdout.toString().trim()).toBe("function")
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
