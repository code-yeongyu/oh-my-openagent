/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkOmowrightRuntimeFresh, stageOmowrightRuntime } from "./stage-omowright-runtime.mjs"

const tempDirs: string[] = []

// An installed omowright carries TypeScript sources (since its strict port), JavaScript sources
// (before it), or a compiled dist/ (a package built for its exports). The page bundle is JavaScript in
// every layout. Each module exports `layout` so a test can tell which one was staged (#12842, #12851).
type Layout = "ts" | "js" | "dist"

async function writeLayout(root: string, layout: Layout): Promise<void> {
  const dir = layout === "dist" ? "dist" : "src"
  const ext = layout === "ts" ? "ts" : "js"
  await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, dir, "page-bundle.js"), "(function(){ globalThis.__omowright = { fixture: true } })();\n")
  await writeFile(
    join(root, dir, `core.${ext}`),
    ext === "ts" ? "export const core: string = 'fixture'\n" : "export const core = 'fixture'\n",
  )
  await writeFile(
    join(root, dir, `index.${ext}`),
    [
      "import { readFileSync } from 'node:fs'",
      `export { core } from './core.${ext}'`,
      `export const layout = '${layout}'`,
      "export const pageBundle = readFileSync(new URL('./page-bundle.js', import.meta.url), 'utf8')",
      "export function connectBrowserSkill() { return 'fixture-session' }",
    ].join("\n"),
  )
}

async function makeSourceFixture(layouts: readonly Layout[] = ["js"], root?: string): Promise<string> {
  const sourceRoot = root ?? (await mkdtemp(join(tmpdir(), "omowright-stage-source-")))
  if (root === undefined) tempDirs.push(sourceRoot)
  await mkdir(sourceRoot, { recursive: true })
  await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "omowright", version: "0.0.1-fixture", type: "module" }))
  await writeFile(join(sourceRoot, "LICENSE"), "MIT License\n\nfixture notice\n")
  for (const layout of layouts) await writeLayout(sourceRoot, layout)
  return sourceRoot
}

async function stageInto(sourceRoot: string): Promise<string> {
  const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
  tempDirs.push(targetParent)
  const targetDir = join(targetParent, "omowright")
  await stageOmowrightRuntime({ sourceRoot, targetDir })
  return targetDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("omowright runtime staging", () => {
  test("#given an omowright source tree #when staged #then one importable bundle, its page bundle and a manifest land in the target", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")

    const staged = await stageOmowrightRuntime({ sourceRoot, targetDir })

    expect(staged.version).toBe("0.0.1-fixture")
    const loaded = await import(join(targetDir, "index.js"))
    expect(loaded.connectBrowserSkill()).toBe("fixture-session")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    const manifest = JSON.parse(await readFile(join(targetDir, "manifest.json"), "utf8"))
    expect(Object.keys(manifest.files).sort()).toEqual(["LICENSE", "index.js", "page-bundle.js"])
    // License contract (omowright#290): omowright's MIT text ships byte-for-byte beside the bundle.
    expect(await readFile(join(targetDir, "LICENSE"), "utf8")).toBe(await readFile(join(sourceRoot, "LICENSE"), "utf8"))
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true, version: "0.0.1-fixture" })
  })

  test("#given an omowright source tree in TypeScript #when staged #then the bundle is JavaScript that imports and the freshness digest tracks the .ts sources", async () => {
    const sourceRoot = await makeSourceFixture(["ts"])
    const targetDir = await stageInto(sourceRoot)

    const loaded = await import(join(targetDir, "index.js"))
    expect(loaded.connectBrowserSkill()).toBe("fixture-session")
    expect(loaded.core).toBe("fixture")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true })

    await writeFile(join(sourceRoot, "src", "core.ts"), "export const core: string = 'changed'\n")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/sourceDigest/)
  })

  test("#given an omowright built for its exports, with dist/ and no sources #when staged #then the dist entry and dist page bundle are staged", async () => {
    const sourceRoot = await makeSourceFixture(["dist"])
    const targetDir = await stageInto(sourceRoot)

    const loaded = await import(join(targetDir, "index.js"))
    expect(loaded.layout).toBe("dist")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true })
  })

  test("#given TypeScript, JavaScript and dist all installed #when staged and loaded #then the stager and the browser skill's loader both take src/index.ts", async () => {
    const tree = await mkdtemp(join(tmpdir(), "omowright-layout-order-"))
    tempDirs.push(tree)
    const sourceRoot = await makeSourceFixture(["ts", "js", "dist"], join(tree, "node_modules", "omowright"))
    const scripts = join(tree, "packages", "shared-skills", "skills", "browser", "scripts")
    await cp(join(import.meta.dir, "skills", "browser", "scripts"), scripts, { recursive: true })

    const staged = await import(join(await stageInto(sourceRoot), "index.js"))
    const { resolveOmowrightEntry } = await import(join(scripts, "omowright.mjs"))

    expect(staged.layout).toBe("ts")
    expect(resolveOmowrightEntry({})).toBe(join(sourceRoot, "src", "index.ts"))
  })

  test("#given a staged runtime #when the source changes #then the freshness check rejects it", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")
    await stageOmowrightRuntime({ sourceRoot, targetDir })

    await writeFile(join(sourceRoot, "src", "core.js"), "export const core = 'changed'\n")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/sourceDigest/)
  })

  test("#given a staged runtime #when omowright's LICENSE changes #then the freshness check rejects it", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetDir = await stageInto(sourceRoot)

    await writeFile(join(sourceRoot, "LICENSE"), "MIT License\n\nchanged notice\n")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/sourceDigest/)
  })

  test("#given a staged runtime #when a staged file is edited by hand #then the freshness check rejects it", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")
    await stageOmowrightRuntime({ sourceRoot, targetDir })

    await writeFile(join(targetDir, "page-bundle.js"), "tampered\n")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/page-bundle\.js sha256/)
  })

  test("#given an omowright source without LICENSE #when staged #then staging refuses instead of shipping the bundle without its notice", async () => {
    const sourceRoot = await makeSourceFixture()
    await rm(join(sourceRoot, "LICENSE"))
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)

    await expect(stageOmowrightRuntime({ sourceRoot, targetDir: join(targetParent, "omowright") })).rejects.toThrow(/no LICENSE/)
  })

  test("#given no staged runtime #when checked #then it reports the missing manifest", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetDir = join(sourceRoot, "never-staged")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/manifest is missing/)
  })
})
