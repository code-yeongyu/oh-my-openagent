import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { estimateSystemTokens } from "./tokens"

const tempDirs: string[] = []

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "memory-tokens-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("estimateSystemTokens", () => {
  test("#given no system directory #when estimated #then the total is zero", async () => {
    // given
    const dir = await tempRepo()

    // when
    const estimate = await estimateSystemTokens(dir)

    // then
    expect(estimate.totalTokens).toBe(0)
    expect(estimate.files).toEqual([])
  })

  test("#given system files including nested paths #when estimated #then tokens are bytes/4 per file sorted by size", async () => {
    // given
    const dir = await tempRepo()
    await mkdir(join(dir, "system", "projects"), { recursive: true })
    await writeFile(join(dir, "system", "persona.md"), "a".repeat(40))
    await writeFile(join(dir, "system", "projects", "index.md"), "b".repeat(8))
    await writeFile(join(dir, "external", "ignored.md"), "c".repeat(400)).catch(async () => {
      await mkdir(join(dir, "external"), { recursive: true })
      await writeFile(join(dir, "external", "ignored.md"), "c".repeat(400))
    })

    // when
    const estimate = await estimateSystemTokens(dir)

    // then
    expect(estimate.files).toEqual([
      { path: "system/persona.md", bytes: 40, tokens: 10 },
      { path: "system/projects/index.md", bytes: 8, tokens: 2 },
    ])
    expect(estimate.totalBytes).toBe(48)
    expect(estimate.totalTokens).toBe(12)
  })

  test("#given a file whose byte length is not divisible by four #when estimated #then the file rounds up", async () => {
    // given
    const dir = await tempRepo()
    await mkdir(join(dir, "system"), { recursive: true })
    await writeFile(join(dir, "system", "odd.md"), "abcde")

    // when
    const estimate = await estimateSystemTokens(dir)

    // then
    expect(estimate.files[0]?.tokens).toBe(2)
    expect(estimate.totalTokens).toBe(2)
  })
})
