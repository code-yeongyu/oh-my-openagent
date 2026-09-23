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

describe("standalone command generation", () => {
  test("#given an OpenCode command template #when generating #then preserves positional and complete argument tokens", async () => {
    // given
    const fixture = await commandFixture("---\ndescription: Deploy target\n---\nDeploy $1 to $2 with $ARGUMENTS")

    // when
    await generateStandaloneParity(fixture.input)

    // then
    expect(await Bun.file(join(fixture.outputRoot, "commands.json")).json()).toEqual([
      { name: "deploy", description: "Deploy target", template: "Deploy $1 to $2 with $ARGUMENTS" },
    ])
  })

  test.each(["agent: build", "model: openai/example", "subtask: true", "permission: allow"])(
    "#given unsupported command metadata %s #when generating #then omits the command with a compatibility report",
    async (metadata) => {
      // given
      const fixture = await commandFixture(`---\ndescription: Deploy target\n${metadata}\n---\nDeploy`)

      // when
      await generateStandaloneParity(fixture.input)

      // then
      expect(await Bun.file(join(fixture.outputRoot, "commands.json")).json()).toEqual([])
      expect(await Bun.file(join(fixture.outputRoot, "command-report.json")).json()).toEqual({
        skipped: [{ name: "deploy", reason: "OpenCode-only command metadata" }],
      })
    },
  )

  test("#given malformed command frontmatter #when generating #then rejects the command without publishing output", async () => {
    // given
    const fixture = await commandFixture("description: missing delimiters")

    // when
    const result = generateStandaloneParity(fixture.input)

    // then
    await expect(result).rejects.toThrow("command frontmatter missing")
    expect(await Bun.file(join(fixture.outputRoot, "manifest.json")).exists()).toBe(false)
  })
})

async function commandFixture(source: string): Promise<{
  readonly input: Parameters<typeof generateStandaloneParity>[0]
  readonly outputRoot: string
}> {
  const root = await mkdtemp(join(tmpdir(), "omo-parity-commands-"))
  roots.push(root)
  const commands = join(root, "commands")
  const instructions = join(root, "AGENTS.md")
  const outputRoot = join(root, "output")
  await mkdir(commands, { recursive: true })
  await writeFile(join(commands, "deploy.md"), source)
  await writeFile(instructions, "# Rules")
  return {
    outputRoot,
    input: { outputRoot, skillRoots: [], commandRoots: [commands], instructionPaths: [instructions] },
  }
}
