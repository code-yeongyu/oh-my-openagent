import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTaskSkillLoader } from "./task-skill-loader"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-task-skill-loader-"))
  roots.push(root)
  return root
}

function writeSkill(root: string, body: string): void {
  const skillDir = join(root, "shared")
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: shared\ndescription: shared test skill\n---\n${body}\n`,
  )
}

describe("createTaskSkillLoader", () => {
  test("#given canonical and packaged skill roots #when the loader resolves a collision #then canonical wins", () => {
    const cwd = tempDir()
    const agentDir = tempDir()
    const pluginSkillsDir = tempDir()
    writeSkill(join(agentDir, "skills"), "CANONICAL BODY")
    writeSkill(pluginSkillsDir, "PACKAGED BODY")

    const loader = createTaskSkillLoader({
      agentDir,
      homeDir: tempDir(),
      pluginSkillsDirs: [pluginSkillsDir],
    })
    const resolution = loader(["shared"], cwd)

    expect(resolution.resolved).toEqual(["shared"])
    expect(resolution.prepend).toContain("CANONICAL BODY")
    expect(resolution.prepend).not.toContain("PACKAGED BODY")
  })
})
