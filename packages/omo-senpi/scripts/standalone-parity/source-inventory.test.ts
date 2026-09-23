/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { generateStandaloneParity } from "./generator"
import { rejectUnsafeRelativePath } from "./safe-files"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  readonly sourceRoot: string
  readonly outputRoot: string
}> {
  const root = await mkdtemp(join(tmpdir(), "omo-standalone-parity-"))
  roots.push(root)
  const sourceRoot = join(root, "source")
  const outputRoot = join(root, "output")
  await mkdir(join(sourceRoot, "skills", "deploy", "references"), { recursive: true })
  await mkdir(join(sourceRoot, "commands"), { recursive: true })
  await writeFile(join(sourceRoot, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: deploy safely\n---\nUse $ARGUMENTS.")
  await writeFile(join(sourceRoot, "skills", "deploy", "references", "runbook.md"), "# Runbook")
  await writeFile(join(sourceRoot, "commands", "ship.md"), "---\ndescription: Ship\n---\nDeploy $1 and $ARGUMENTS")
  await writeFile(join(sourceRoot, "AGENTS.md"), "# Global\nFollow the runbook.")
  return { sourceRoot, outputRoot }
}

describe("generateStandaloneParity", () => {
  test("#given compatible personal resources #when generating a staging payload #then copies only self-contained resources and writes a hash manifest", async () => {
    // given
    const { sourceRoot, outputRoot } = await fixture()
    const parityExtension = join(sourceRoot, "omo-standalone-parity.js")
    await writeFile(parityExtension, "export default async () => {}\n")

    // when
    const generated = await generateStandaloneParity({
      outputRoot,
      skillRoots: [join(sourceRoot, "skills")],
      commandRoots: [join(sourceRoot, "commands")],
      instructionPaths: [join(sourceRoot, "AGENTS.md")],
      parityExtensionPath: parityExtension,
    })

    // then
    expect(generated.manifest.skills).toEqual(["deploy"])
    expect(generated.manifest.commands).toEqual(["ship"])
    expect(await Bun.file(join(outputRoot, "skills", "deploy", "references", "runbook.md")).text()).toBe("# Runbook")
    expect(generated.manifest.files["instructions.md"]).toMatch(/^[a-f0-9]{64}$/u)
    expect(await Bun.file(join(outputRoot, "package", "package.json")).json()).toEqual({
      name: "@code-yeongyu/omo-senpi-standalone-parity",
      private: true,
      type: "module",
      pi: { extensions: ["./extensions/omo-standalone-parity.js"] },
    })
    expect(await Bun.file(join(outputRoot, "package", "extensions", "omo-standalone-parity.js")).text()).toBe("export default async () => {}\n")
    expect(await Bun.file(join(outputRoot, "manifest.json")).exists()).toBe(true)
  })

  test("#given a source root containing an escaping symlink #when generating #then fails before creating a payload", async () => {
    // given
    const { sourceRoot, outputRoot } = await fixture()
    await symlink(join(tmpdir(), "outside"), join(sourceRoot, "skills", "escape"))

    // when
    const result = generateStandaloneParity({
      outputRoot,
      skillRoots: [join(sourceRoot, "skills")],
      commandRoots: [join(sourceRoot, "commands")],
      instructionPaths: [join(sourceRoot, "AGENTS.md")],
    })

    // then
    await expect(result).rejects.toThrow("symlink")
    expect(await Bun.file(join(outputRoot, "manifest.json")).exists()).toBe(false)
    expect((await readdir(dirname(outputRoot))).filter((entry) => entry.startsWith(".standalone-parity-stage-"))).toEqual([])
  })

  test("#given a skill alias to another selected root #when generating #then copies the resolved files without a symlink", async () => {
    // given
    const { sourceRoot, outputRoot } = await fixture()
    const aliasesRoot = join(sourceRoot, "aliases")
    await mkdir(aliasesRoot, { recursive: true })
    await symlink(join(sourceRoot, "skills", "deploy"), join(aliasesRoot, "alias"))

    // when
    const generated = await generateStandaloneParity({
      outputRoot,
      skillRoots: [aliasesRoot, join(sourceRoot, "skills")],
      commandRoots: [join(sourceRoot, "commands")],
      instructionPaths: [join(sourceRoot, "AGENTS.md")],
    })

    // then
    expect(generated.manifest.skills).toEqual(["alias", "deploy"])
    expect((await Bun.file(join(outputRoot, "skills", "alias", "SKILL.md")).text()).includes("deploy safely")).toBe(true)
  })

  test("#given a command with agent selection metadata #when generating #then reports and omits unsupported execution metadata", async () => {
    // given
    const { sourceRoot, outputRoot } = await fixture()
    await writeFile(join(sourceRoot, "commands", "handoff.md"), "---\ndescription: Handoff\nagent: build\n---\nUse $1 and $2")

    // when
    const generated = await generateStandaloneParity({
      outputRoot,
      skillRoots: [join(sourceRoot, "skills")],
      commandRoots: [join(sourceRoot, "commands")],
      instructionPaths: [join(sourceRoot, "AGENTS.md")],
    })

    // then
    expect(generated.manifest.commands).not.toContain("handoff")
    expect(await Bun.file(join(outputRoot, "command-report.json")).json()).toEqual({
      skipped: [{ name: "handoff", reason: "OpenCode-only command metadata" }],
    })
  })

  test("#given duplicate skill and command names #when generating from ordered roots #then the first root wins deterministically", async () => {
    // given
    const { sourceRoot, outputRoot } = await fixture()
    const secondRoot = join(dirname(sourceRoot), "second")
    await mkdir(join(secondRoot, "skills", "deploy"), { recursive: true })
    await mkdir(join(secondRoot, "commands"), { recursive: true })
    await writeFile(join(secondRoot, "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: second\n---\nsecond")
    await writeFile(join(secondRoot, "commands", "ship.md"), "---\ndescription: second\n---\nsecond")

    // when
    await generateStandaloneParity({
      outputRoot,
      skillRoots: [join(sourceRoot, "skills"), join(secondRoot, "skills")],
      commandRoots: [join(sourceRoot, "commands"), join(secondRoot, "commands")],
      instructionPaths: [join(sourceRoot, "AGENTS.md")],
    })

    // then
    expect(await readFile(join(outputRoot, "skills", "deploy", "SKILL.md"), "utf8")).toContain("deploy safely")
    expect(JSON.parse(await readFile(join(outputRoot, "commands.json"), "utf8"))).toEqual([
      { name: "ship", description: "Ship", template: "Deploy $1 and $ARGUMENTS" },
    ])
  })

  test("#given forbidden cache and credential files inside a skill #when generating #then excludes them without rejecting the safe skill closure", async () => {
    // given
    const { sourceRoot, outputRoot } = await fixture()
    await mkdir(join(sourceRoot, "skills", "deploy", "cache"), { recursive: true })
    await writeFile(join(sourceRoot, "skills", "deploy", "cache", "index.json"), "private")
    await writeFile(join(sourceRoot, "skills", "deploy", "auth.json"), "private")

    // when
    await generateStandaloneParity({
      outputRoot,
      skillRoots: [join(sourceRoot, "skills")],
      commandRoots: [join(sourceRoot, "commands")],
      instructionPaths: [join(sourceRoot, "AGENTS.md")],
    })

    // then
    expect(await Bun.file(join(outputRoot, "skills", "deploy", "SKILL.md")).exists()).toBe(true)
    expect(await Bun.file(join(outputRoot, "skills", "deploy", "cache", "index.json")).exists()).toBe(false)
    expect(await Bun.file(join(outputRoot, "skills", "deploy", "auth.json")).exists()).toBe(false)
  })

  test("#given an escaping relative path #when validating inventory input #then rejects traversal", () => {
    // given
    const escapingPath = "../outside.txt"

    // when
    const result = () => rejectUnsafeRelativePath(escapingPath)

    // then
    expect(result).toThrow("forbidden path")
  })
})
