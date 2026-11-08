/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkOmowrightRuntimeFresh, stageOmowrightRuntime } from "./stage-omowright-runtime.mjs"

const tempDirs: string[] = []

async function makeSourceFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omowright-stage-source-"))
  tempDirs.push(root)
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "omowright", version: "0.0.1-fixture", type: "module" }))
  await writeFile(join(root, "src", "page-bundle.js"), "(function(){ globalThis.__omowright = { fixture: true } })();\n")
  await writeFile(join(root, "src", "core.js"), "export const core = 'fixture'\n")
  await writeFile(
    join(root, "src", "index.js"),
    [
      "import { readFileSync } from 'node:fs'",
      "export { core } from './core.js'",
      "export const pageBundle = readFileSync(new URL('./page-bundle.js', import.meta.url), 'utf8')",
      "export function connectBrowserSkill() { return 'fixture-session' }",
    ].join("\n"),
  )
  return root
}

// #12842: omowright main ships TypeScript sources (src/index.ts, src/core.ts); the page bundle stays JavaScript.
async function makeTypeScriptSourceFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omowright-stage-ts-source-"))
  tempDirs.push(root)
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "omowright", version: "0.0.2-ts-fixture", type: "module" }))
  await writeFile(join(root, "src", "page-bundle.js"), "(function(){ globalThis.__omowright = { fixture: true } })();\n")
  await writeFile(join(root, "src", "core.ts"), "export const core: string = 'ts-fixture'\n")
  await writeFile(
    join(root, "src", "index.ts"),
    [
      "import { readFileSync } from 'node:fs'",
      "export { core } from './core.ts'",
      "interface Session { readonly name: string }",
      "export const pageBundle: string = readFileSync(new URL('./page-bundle.js', import.meta.url), 'utf8')",
      "export function connectBrowserSkill(): Session['name'] { return 'ts-fixture-session' }",
    ].join("\n"),
  )
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
    expect(loaded.connectBrowserSkill()).toBe("fixture-session")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    const manifest = JSON.parse(await readFile(join(targetDir, "manifest.json"), "utf8"))
    expect(Object.keys(manifest.files).sort()).toEqual(["index.js", "page-bundle.js"])
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true, version: "0.0.1-fixture" })
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

  test("#given an omowright source tree with TypeScript sources #when staged #then the bundle compiles them into one importable index.js and the check passes", async () => {
    // given
    const sourceRoot = await makeTypeScriptSourceFixture()
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")

    // when
    const staged = await stageOmowrightRuntime({ sourceRoot, targetDir })

    // then
    expect(staged.version).toBe("0.0.2-ts-fixture")
    const loaded = await import(join(targetDir, "index.js"))
    expect(loaded.connectBrowserSkill()).toBe("ts-fixture-session")
    expect(loaded.core).toBe("ts-fixture")
    expect(loaded.pageBundle).toContain("globalThis.__omowright")
    const manifest = JSON.parse(await readFile(join(targetDir, "manifest.json"), "utf8"))
    expect(Object.keys(manifest.files).sort()).toEqual(["index.js", "page-bundle.js"])
    expect(await checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).toMatchObject({ ok: true, version: "0.0.2-ts-fixture" })
  })

  test("#given a runtime staged from TypeScript sources #when core.ts changes #then the freshness check rejects it", async () => {
    // given
    const sourceRoot = await makeTypeScriptSourceFixture()
    const targetParent = await mkdtemp(join(tmpdir(), "omowright-stage-target-"))
    tempDirs.push(targetParent)
    const targetDir = join(targetParent, "omowright")
    await stageOmowrightRuntime({ sourceRoot, targetDir })

    // when
    await writeFile(join(sourceRoot, "src", "core.ts"), "export const core: string = 'changed'\n")

    // then
    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/sourceDigest/)
  })

  test("#given a source tree with neither index.js nor index.ts #when staged #then it names both entries it looked for", async () => {
    // given
    const sourceRoot = await makeTypeScriptSourceFixture()
    await rm(join(sourceRoot, "src", "index.ts"))

    // when / then
    await expect(stageOmowrightRuntime({ sourceRoot, targetDir: join(sourceRoot, "never-staged") })).rejects.toThrow(/neither src\/index\.js nor src\/index\.ts/)
  })

  test("#given no staged runtime #when checked #then it reports the missing manifest", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetDir = join(sourceRoot, "never-staged")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/manifest is missing/)
  })
})
