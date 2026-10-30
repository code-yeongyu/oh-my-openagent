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

  test("#given no staged runtime #when checked #then it reports the missing manifest", async () => {
    const sourceRoot = await makeSourceFixture()
    const targetDir = join(sourceRoot, "never-staged")

    await expect(checkOmowrightRuntimeFresh({ sourceRoot, targetDir })).rejects.toThrow(/manifest is missing/)
  })
})
