import { readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { describe, expect, test } from "bun:test"

// The caller ruling for the omo SDK's config reads (#15298): config.explain, config.check and config.modelSwaps take
// exactly config.status's callers, the local owner and local sessions acting for that owner, never a remote relay
// caller, a connector, a guest or another device's session. The SDK has no runtime principal check to share: every call
// of it, config.status included, is reachable only in process, by importing the built entry from OMO_SDK_ROOT in a
// local session or the owner's own script. This audit holds that shape: a module outside the list below that imports
// the SDK, or reads OMO_SDK_ROOT, could expose these calls to a remote caller, and fails here.
const REPO_ROOT = join(import.meta.dir, "..", "..", "..")
const SDK_REFERENCE = /components\/omo-sdk(?:\/|["'])|omo-sdk\/sdk\.js|OMO_SDK_ROOT|createOmoSdk/u

const SANCTIONED: ReadonlySet<string> = new Set([
  // the SDK entry the plugin build turns into plugin/runtime/omo-sdk/sdk.js
  "packages/omo-senpi/src/extension/omo-sdk.ts",
  // publishes OMO_SDK_ROOT into the local engine's environment for its eval cells
  "packages/omo-senpi/src/extension/compose.ts",
  "packages/omo-senpi/src/extension/sdk-root-provisioning.ts",
])

async function sourcesReferencingTheSdk(): Promise<readonly string[]> {
  const found: string[] = []
  const glob = new Bun.Glob("packages/*/{src,bin}/**/*.{ts,mts,mjs,js}")
  for await (const path of glob.scan({ cwd: REPO_ROOT, onlyFiles: true })) {
    if (/\.test\.|\/node_modules\/|\.d\.ts$/u.test(path)) continue
    if (path.startsWith("packages/omo-senpi/src/components/omo-sdk/")) continue
    if (SDK_REFERENCE.test(await readFile(join(REPO_ROOT, path), "utf8")))
      found.push(relative(REPO_ROOT, join(REPO_ROOT, path)))
  }
  return found.sort()
}

describe("omo SDK reachability", () => {
  test("#given the forms a module would use to reach the SDK #when they are matched #then each one is caught", () => {
    // given
    const reaches = [
      'import { createOmoSdk } from "../components/omo-sdk"',
      'import type { ConfigApi } from "../../components/omo-sdk/config"',
      "const root = process.env.OMO_SDK_ROOT",
      "await import(`${root}/omo-sdk/sdk.js`)",
    ]

    // when
    const caught = reaches.filter((line) => SDK_REFERENCE.test(line))

    // then
    expect(caught).toEqual(reaches)
  })

  test("#given the repository's sources #when they are scanned for the omo SDK #then only the local entry and its provisioning reference it", async () => {
    // given
    const sanctioned = [...SANCTIONED].sort()

    // when
    const found = await sourcesReferencingTheSdk()

    // then
    expect(found.filter((path) => !SANCTIONED.has(path))).toEqual([])
    expect(found).toEqual(sanctioned)
  })
})
