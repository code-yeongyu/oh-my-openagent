/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { generateStandaloneParity } from "./generator"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("standalone instruction generation", () => {
  test("#given deterministic nested includes #when generating #then expands each file once in dependency order", async () => {
    // given
    const fixture = await instructionFixture()
    await mkdir(join(fixture.sourceRoot, "rules"), { recursive: true })
    await writeFile(join(fixture.sourceRoot, "AGENTS.md"), "root-before\n@rules/one.md\nroot-after")
    await writeFile(join(fixture.sourceRoot, "rules", "one.md"), "one-before\n@two.md\none-after")
    await writeFile(join(fixture.sourceRoot, "rules", "two.md"), "two")

    // when
    await generateStandaloneParity(fixture.input)

    // then
    expect(await Bun.file(join(fixture.outputRoot, "instructions.md")).text()).toBe(
      "two\n\none-before\none-after\n\nroot-before\nroot-after",
    )
  })

  test("#given an include cycle #when generating #then rejects the cycle without publishing output", async () => {
    // given
    const fixture = await instructionFixture()
    await writeFile(join(fixture.sourceRoot, "AGENTS.md"), "@one.md")
    await writeFile(join(fixture.sourceRoot, "one.md"), "@AGENTS.md")

    // when
    const result = generateStandaloneParity(fixture.input)

    // then
    await expect(result).rejects.toThrow("instruction include cycle")
    expect(await Bun.file(join(fixture.outputRoot, "manifest.json")).exists()).toBe(false)
  })

  test("#given a missing include #when generating #then reports the include as invalid input", async () => {
    // given
    const fixture = await instructionFixture()
    await writeFile(join(fixture.sourceRoot, "AGENTS.md"), "@missing.md")

    // when
    const result = generateStandaloneParity(fixture.input)

    // then
    await expect(result).rejects.toThrow("instruction include missing")
  })

  test("#given an include outside the instruction root #when generating #then rejects traversal", async () => {
    // given
    const fixture = await instructionFixture()
    await writeFile(join(fixture.sourceRoot, "AGENTS.md"), "@../outside.md")
    await writeFile(join(fixture.root, "outside.md"), "outside")

    // when
    const result = generateStandaloneParity(fixture.input)

    // then
    await expect(result).rejects.toThrow("path escapes source root")
  })
})

async function instructionFixture(): Promise<{
  readonly root: string
  readonly sourceRoot: string
  readonly outputRoot: string
  readonly input: Parameters<typeof generateStandaloneParity>[0]
}> {
  const root = await mkdtemp(join(tmpdir(), "omo-parity-instructions-"))
  roots.push(root)
  const sourceRoot = join(root, "source")
  const outputRoot = join(root, "output")
  await mkdir(sourceRoot, { recursive: true })
  return {
    root,
    sourceRoot,
    outputRoot,
    input: { outputRoot, skillRoots: [], commandRoots: [], instructionPaths: [join(sourceRoot, "AGENTS.md")] },
  }
}
