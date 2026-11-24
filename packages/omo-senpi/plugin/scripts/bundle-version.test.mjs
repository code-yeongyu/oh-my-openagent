import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// #14867: a release stamp bumps the manifests only. The committed bundles must not carry the version, so the stamp
// rewrites none of them; every consumer reads the version from the plugin manifest that ships beside the bundles.
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"))
const scratch = mkdtempSync(join(tmpdir(), "omo-senpi-bundle-version-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const committedBundles = execFileSync("git", ["ls-files", "extensions", "runtime"], { cwd: pluginRoot, encoding: "utf8" })
  .split("\n")
  .filter((path) => /\.m?js$/.test(path))

describe("committed Senpi bundles and the release version", () => {
  test("#given every committed bundle #when searched for the manifest version #then none contains it", () => {
    expect(committedBundles.length).toBeGreaterThan(0)
    const literal = JSON.stringify(manifest.version)
    const carrying = committedBundles.filter((path) => readFileSync(join(pluginRoot, path), "utf8").includes(literal))
    expect(carrying).toEqual([])
  })

  test("#given a copied plugin whose manifest is bumped without a rebuild #when the eval SDKs load #then they report the bumped version", async () => {
    const copy = join(scratch, "plugin")
    cpSync(join(pluginRoot, "runtime"), join(copy, "runtime"), { recursive: true })
    const bumped = `${manifest.version}-stamp.14867`
    writeFileSync(join(copy, "package.json"), JSON.stringify({ ...manifest, version: bumped }))
    const versions = {}
    for (const sdk of ["agent-toolkit-sdk", "bunshin-ts", "omo-sdk"]) {
      const module = await import(pathToFileURL(join(copy, "runtime", sdk, "sdk.js")).href)
      versions[sdk] = module.SDK_VERSION
    }
    expect(versions).toEqual({ "agent-toolkit-sdk": bumped, "bunshin-ts": bumped, "omo-sdk": bumped })
  })
})
