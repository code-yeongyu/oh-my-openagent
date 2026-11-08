/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkOmowrightRuntimeFresh, stageOmowrightRuntime } from "./stage-omowright-runtime.mjs"

const tempDirs: string[] = []

// An installed omowright has one of three layouts: TypeScript sources (a git dependency at the
// current pin, code-yeongyu/omowright#266), the older JavaScript sources, or compiled `dist/` with no
// sources at all (what its `exports` points at once the package is built, #269). Staging must accept
// every layout a consumer can be handed (#12842).
async function makeSourceFixture(layout: "ts" | "js" | "dist" = "js", options: { alsoJavaScript?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omowright-stage-source-"))
  tempDirs.push(root)
  const dir = layout === "dist" ? "dist" : "src"
  await mkdir(join(root, dir), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "omowright", version: "0.0.1-fixture", type: "module" }))
  await writeFile(join(root, dir, "page-bundle.js"), "(function(){ globalThis.__omowright = { fixture: true } })();\n")
  const extension = layout === "ts" ? "ts" : "js"
  const sourceEntry = (moduleExtension: "js" | "ts"): string =>
    [
      "import { readFileSync } from 'node:fs'",
      `export { core } from './core.${moduleExtension}'`,
      "export const pageBundle = readFileSync(new URL('./page-bundle.js', import.meta.url), 'utf8')",
      `export function connectBrowserSkill() { return '${moduleExtension}-session' }`,
    ].join("\n")
  // Compiled output is one self-contained file, exactly what `bun build.ts` writes to `dist/`.
  const compiledEntry = [
    "import { readFileSync } from 'node:fs'",
    "export const pageBundle = readFileSync(new URL('./page-bundle.js', import.meta.url), 'utf8')",
    "export const core = 'js-core'",
    "export function connectBrowserSkill() { return 'js-session' }",
  ].join("\n")
  if (layout === "dist") {
    await writeFile(join(root, "dist", "index.js"), compiledEntry)
    return root
  }
  await writeFile(join(root, "src", `core.${extension}`), `export const core = '${extension}-core'\n`)
  await writeFile(join(root, "src", `index.${extension}`), sourceEntry(extension))
  if (options.alsoJavaScript === true) {
    // A checkout holding both source layouts must resolve to ONE entry, and it is the TypeScript one --
    // the same preference the browser skill's loader applies (#12851).
    await writeFile(join(root, "src", "core.js"), "export const core = 'js-core'\n")
    await writeFile(join(root, "src", "index.js"), sourceEntry("js"))
  }
  return root
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
    expect(loaded.connectBrowserSkill()).toBe("js-session")
    expect(loaded.core).toBe("js-core")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    const manifest = JSON.parse(await readFile(join(targetDir, "manifest.json"), "utf8"))
    expect(Object.keys(manifest.files).sort()).toEqual(["index.js", "page-bundle.js"])
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true, version: "0.0.1-fixture" })
  })

  test("#given the TypeScript sources a git dependency installs #when staged #then the bundle is JavaScript and the digest tracks the .ts files", async () => {
    const sourceRoot = await makeSourceFixture("ts")
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")

    await stageOmowrightRuntime({ sourceRoot, targetDir })

    const loaded = await import(join(targetDir, "index.js"))
    expect(loaded.connectBrowserSkill()).toBe("ts-session")
    expect(loaded.core).toBe("ts-core")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true })

    await writeFile(join(sourceRoot, "src", "core.ts"), "export const core: string = 'changed'\n")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/sourceDigest/)
  })

  test("#given a checkout with both source layouts #when staged #then the TypeScript entry wins, as the loader resolves it", async () => {
    const sourceRoot = await makeSourceFixture("ts", { alsoJavaScript: true })
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")

    await stageOmowrightRuntime({ sourceRoot, targetDir })

    const loaded = await import(join(targetDir, "index.js"))
    expect(loaded.connectBrowserSkill()).toBe("ts-session")
  })

  test("#given a package that ships only compiled output #when staged #then it stages from dist", async () => {
    const sourceRoot = await makeSourceFixture("dist")
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")

    await stageOmowrightRuntime({ sourceRoot, targetDir })

    const loaded = await import(join(targetDir, "index.js"))
    expect(loaded.connectBrowserSkill()).toBe("js-session")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true })
  })

  test("#given a package with no entry in any layout #when staged #then the error names the layouts it looked for", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "omowright-stage-empty-"))
    tempDirs.push(sourceRoot)
    await writeFile(join(sourceRoot, "package.json"), JSON.stringify({ name: "omowright", version: "0.0.1-fixture" }))

    await expect(stageOmowrightRuntime({ sourceRoot, targetDir: join(sourceRoot, "out") })).rejects.toThrow(
      /no stageable layout.*src\/index\.ts, src\/index\.js, dist\/index\.js/,
    )
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

  test("#given a staged runtime #when a staged file is edited by hand #then the freshness check rejects it", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")
    await stageOmowrightRuntime({ sourceRoot, targetDir })

    await writeFile(join(targetDir, "page-bundle.js"), "tampered\n")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/page-bundle\.js sha256/)
  })

  test("#given no staged runtime #when checked #then it reports the missing manifest", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetDir = join(sourceRoot, "never-staged")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/manifest is missing/)
  })
})
