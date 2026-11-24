/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import { bundledWorkspaceSources } from "./build-codex-install"

// #14867: a release stamp bumps the manifests only. The committed Codex installer and service-auth bundles must not
// carry the version, so the stamp rewrites neither; each reads it from the manifest that ships beside it.
const repoRoot = join(import.meta.dir, "..")
const scratch = mkdtempSync(join(tmpdir(), "committed-bundle-version-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const read = (path: string) => readFileSync(join(repoRoot, path), "utf8")
const manifestOf = (path: string): Record<string, unknown> & { version: string } => JSON.parse(read(path))

/** Copies a committed bundle into `layout` and appends one export so a test can call an internal it holds. */
async function probeCopy(bundle: string, layout: string, internal: string): Promise<Record<string, unknown>> {
  const copy = join(scratch, layout, bundle)
  mkdirSync(dirname(copy), { recursive: true })
  copyFileSync(join(repoRoot, bundle), copy)
  appendFileSync(copy, `\nexport { ${internal} as __probe };\n`)
  return import(pathToFileURL(copy).href)
}

function writeManifest(layout: string, path: string, manifest: Record<string, unknown>): void {
  const target = join(scratch, layout, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(manifest))
}

describe("the committed Codex installer bundle and the release version", () => {
  const bundle = "packages/omo-codex/scripts/install-dist/install-local.mjs"
  const plugin = manifestOf("packages/omo-codex/plugin/package.json")

  test("#given the committed bundle #when its inlined sources and literals are read #then no manifest version is in it", () => {
    const text = read(bundle)
    expect(bundledWorkspaceSources(text)).not.toContain("packages/omo-codex/package.json")
    expect(text).not.toContain(JSON.stringify(manifestOf("packages/omo-codex/package.json").version))
  })

  test("#given a copied install whose plugin manifest is bumped without a rebuild #when telemetry asks the version #then it is the bumped one", async () => {
    const bumped = `${plugin.version}-stamp.14867`
    writeManifest("codex", "packages/omo-codex/plugin/package.json", { ...plugin, version: bumped })
    const module = await probeCopy(bundle, "codex", "getProductVersion")
    expect((module.__probe as () => string)()).toBe(bumped)
  })
})

describe("the committed service-auth bundle and the release version", () => {
  const bundle = "packages/omo-native/bin/lib/service-auth.generated.js"
  const native = manifestOf("packages/omo-native/package.json")

  test("#given the committed bundle #when searched for the manifest version #then it is not there", () => {
    expect(read(bundle)).not.toContain(JSON.stringify(native.version))
  })

  test("#given a copied npm install whose manifest is bumped without a rebuild #when the bootstrap names the refresher #then it carries the bumped version", async () => {
    const bumped = `${native.version}-stamp.14867`
    writeManifest("native", "packages/omo-native/package.json", { ...native, version: bumped })
    const module = await probeCopy(bundle, "native", "deviceServiceBootstrapSetup")
    const setup = (module.__probe as (options: Record<string, string>) => { refresher: { version: string } })({
      stateDir: join(scratch, "native-state"),
      binaryPath: join(scratch, "omo"),
      agentDir: join(scratch, "agent"),
    })
    expect(setup.refresher.version).toBe(bumped)
  })
})
