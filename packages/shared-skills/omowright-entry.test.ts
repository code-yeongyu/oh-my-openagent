/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

// #12842: in a checkout without a staged runtime the browser skill falls back to omowright's own sources in the root
// node_modules. omowright main ships them as TypeScript (src/index.ts), so the fallback has to find that entry too.

const tempDirs: string[] = []
const scriptsDir = join(import.meta.dir, "skills", "browser", "scripts")

async function checkoutWithOmowrightSource(entryFile: string): Promise<{ root: string; loaderUrl: string }> {
  const root = await mkdtemp(join(tmpdir(), "omowright-entry-checkout-"))
  tempDirs.push(root)
  const copiedScripts = join(root, "packages", "shared-skills", "skills", "browser", "scripts")
  await mkdir(copiedScripts, { recursive: true })
  for (const name of ["omowright.mjs", "browser-engine-guard.mjs"]) await copyFile(join(scriptsDir, name), join(copiedScripts, name))
  await mkdir(join(root, "node_modules", "omowright", "src"), { recursive: true })
  await writeFile(join(root, "node_modules", "omowright", "src", entryFile), "export const fixture: string = 'checkout'\n")
  return { root, loaderUrl: pathToFileURL(join(copiedScripts, "omowright.mjs")).href }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("browser skill omowright entry fallback (#12842)", () => {
  test("#given a checkout whose omowright ships src/index.ts and no staged runtime #when the entry resolves #then it is the TypeScript entry", async () => {
    // given
    const { root, loaderUrl } = await checkoutWithOmowrightSource("index.ts")
    const { resolveOmowrightEntry } = await import(loaderUrl)

    // when
    const entry = resolveOmowrightEntry({})

    // then
    expect(entry).toBe(join(root, "node_modules", "omowright", "src", "index.ts"))
  })

  test("#given a checkout whose omowright ships src/index.js #when the entry resolves #then the JavaScript entry is still found", async () => {
    // given
    const { loaderUrl } = await checkoutWithOmowrightSource("index.js")
    const { resolveOmowrightEntry } = await import(loaderUrl)

    // when
    const entry = resolveOmowrightEntry({})

    // then
    expect(entry?.endsWith(join("node_modules", "omowright", "src", "index.js"))).toBe(true)
  })
})
