import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import adapterManifest from "../package.json" with { type: "json" }
import { memoryBlockBuild } from "./components/memory/memory-block-build"
import { omoSenpiPackageVersion } from "./package-version"

const scratch = mkdtempSync(join(tmpdir(), "omo-senpi-package-version-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function plugin(name: string, version: string): string {
  const root = join(scratch, name, "plugin")
  for (const bundle of ["extensions/omo.js", "runtime/thread-sdk/sdk.js"]) {
    mkdirSync(dirname(join(root, bundle)), { recursive: true })
    writeFileSync(join(root, bundle), "export {}\n")
  }
  writeManifest(root, { name: "@code-yeongyu/omo-senpi", version })
  return root
}

function writeManifest(root: string, manifest: Record<string, string>): void {
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest))
}

const urlOf = (root: string, bundle: string) => pathToFileURL(join(root, bundle)).href

describe("omoSenpiPackageVersion", () => {
  test("#given a source run #when the version is read #then it is the adapter manifest's", () => {
    expect(omoSenpiPackageVersion()).toBe(adapterManifest.version)
  })

  test("#given bundles at both plugin depths #when the manifest is bumped without a rebuild #then both read the bumped version", () => {
    const root = plugin("bumped", "1.0.0")
    writeManifest(root, { name: "@code-yeongyu/omo-senpi", version: "1.0.1" })
    expect(omoSenpiPackageVersion(urlOf(root, "extensions/omo.js"))).toBe("1.0.1")
    expect(omoSenpiPackageVersion(urlOf(root, "runtime/thread-sdk/sdk.js"))).toBe("1.0.1")
  })

  test("#given a foreign package.json between the bundle and the plugin manifest #when read #then it is skipped", () => {
    const root = plugin("foreign", "2.0.0")
    writeManifest(join(root, "runtime"), { name: "unrelated", version: "9.9.9" })
    expect(omoSenpiPackageVersion(urlOf(root, "runtime/thread-sdk/sdk.js"))).toBe("2.0.0")
  })

  test("#given a bundle inlined into a compiled executable #when read #then it is the plugin manifest's beside the executable", () => {
    // The desktop app's compiled omo inlines extensions/omo-device-account.js (its boot-time memory-sync claim), so
    // the bundle runs from Bun's virtual filesystem, with the runtime bundle's plugin beside the executable.
    const root = plugin("compiled", "4.0.0")
    expect(omoSenpiPackageVersion("file:///$bunfs/root/omo", join(dirname(root), "omo"))).toBe("4.0.0")
  })

  test("#given a bundle with no omo-senpi manifest above it #when read #then it throws instead of guessing", () => {
    const orphan = join(scratch, "orphan", "omo.js")
    mkdirSync(dirname(orphan), { recursive: true })
    writeFileSync(orphan, "export {}\n")
    expect(() => omoSenpiPackageVersion(pathToFileURL(orphan).href, orphan)).toThrow("omo-senpi package manifest not found")
  })
})

describe("memoryBlockBuild", () => {
  test("#given an installed bundle #when the installed version changes #then the build key changes", () => {
    const root = plugin("memory", "3.0.0")
    const bundle = urlOf(root, "extensions/omo.js")
    const before = memoryBlockBuild(bundle, true)
    writeManifest(root, { name: "@code-yeongyu/omo-senpi", version: "3.0.1" })
    const after = memoryBlockBuild(bundle, true)
    expect(before?.startsWith("3.0.0:")).toBe(true)
    expect(after?.startsWith("3.0.1:")).toBe(true)
  })

  test("#given a source run #when the build key is asked #then there is none", () => {
    expect(memoryBlockBuild()).toBeUndefined()
  })
})
