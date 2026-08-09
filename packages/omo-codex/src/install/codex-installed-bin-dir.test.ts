/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readInstalledCodexBinDir, writeInstalledCodexBinDir } from "./codex-installed-bin-dir"

async function makeCodexHome(slug: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `omo-codex-binmanifest-${slug}-`))
}

describe("installed codex bin dir record", () => {
  test("#given a bin dir recorded under the plugin version cache #when it is read back #then the recorded dir is returned", async () => {
    // given
    const codexHome = await makeCodexHome("roundtrip")
    const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "1.2.3")
    await mkdir(pluginRoot, { recursive: true })
    await writeInstalledCodexBinDir({ pluginRoot, binDir: "/custom/bin" })

    // when
    const binDir = await readInstalledCodexBinDir(codexHome)

    // then
    expect(binDir).toBe("/custom/bin")
  })

  test("#given a bin dir recorded under the marketplace snapshot #when it is read back #then the recorded dir is returned", async () => {
    // given
    const codexHome = await makeCodexHome("snapshot")
    const pluginRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo")
    await mkdir(pluginRoot, { recursive: true })
    await writeInstalledCodexBinDir({ pluginRoot, binDir: "/snapshot/bin" })

    // when
    const binDir = await readInstalledCodexBinDir(codexHome)

    // then
    expect(binDir).toBe("/snapshot/bin")
  })

  test("#given no record at all #when it is read #then null is returned so normal resolution applies", async () => {
    // given
    const codexHome = await makeCodexHome("absent")

    // when
    const binDir = await readInstalledCodexBinDir(codexHome)

    // then
    expect(binDir).toBeNull()
  })

  test("#given a malformed or blank record #when it is read #then null is returned rather than a bad directory", async () => {
    // given: a truncated write and a blank value must never produce a sweep target
    const malformedHome = await makeCodexHome("malformed")
    const malformedRoot = join(malformedHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.0")
    await mkdir(malformedRoot, { recursive: true })
    await writeFile(join(malformedRoot, ".installed-bin-dir.json"), "{ not json")

    const blankHome = await makeCodexHome("blank")
    const blankRoot = join(blankHome, "plugins", "cache", "sisyphuslabs", "omo", "1.0.0")
    await mkdir(blankRoot, { recursive: true })
    await writeFile(join(blankRoot, ".installed-bin-dir.json"), JSON.stringify({ binDir: "   " }))

    // when
    const fromMalformed = await readInstalledCodexBinDir(malformedHome)
    const fromBlank = await readInstalledCodexBinDir(blankHome)

    // then
    expect(fromMalformed).toBeNull()
    expect(fromBlank).toBeNull()
  })
})
