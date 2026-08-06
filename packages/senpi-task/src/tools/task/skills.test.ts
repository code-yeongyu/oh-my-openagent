import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { buildSkillPrepend, createFsSkillLoader } from "./skills"

describe("buildSkillPrepend", () => {
  test("#given resolved skills #when prepended #then each SKILL.md is wrapped before the prompt", () => {
    // given
    const skills = [
      { name: "alpha", content: "ALPHA BODY" },
      { name: "beta", content: "BETA BODY" },
    ]

    // when
    const combined = buildSkillPrepend(skills, "the original prompt")

    // then
    expect(combined).toContain("ALPHA BODY")
    expect(combined).toContain("BETA BODY")
    expect(combined.indexOf("ALPHA BODY")).toBeLessThan(combined.indexOf("the original prompt"))
    expect(combined.endsWith("the original prompt")).toBe(true)
  })

  test("#given no skills #when prepended #then the prompt is returned unchanged", () => {
    // when
    const combined = buildSkillPrepend([], "just the prompt")

    // then
    expect(combined).toBe("just the prompt")
  })
})

describe("createFsSkillLoader", () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), "senpi-task-skills-"))
    roots.push(root)
    return root
  }

  test("#given a project skill dir #when a skill is loaded #then its SKILL.md content is resolved and prepended", () => {
    // given
    const cwd = scratch()
    const skillDir = join(cwd, ".senpi", "skills", "reviewer")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "REVIEWER DIRECTIVE", "utf8")
    const loader = createFsSkillLoader({ homeDir: scratch() })

    // when
    const resolution = loader(["reviewer"], cwd)

    // then
    expect(resolution.resolved).toEqual(["reviewer"])
    expect(resolution.missing).toEqual([])
    expect(resolution.prepend).toContain("REVIEWER DIRECTIVE")
  })

  test("#given a missing skill #when loaded #then it is reported missing and prepend is empty", () => {
    // given
    const cwd = scratch()
    const loader = createFsSkillLoader({ homeDir: scratch() })

    // when
    const resolution = loader(["ghost"], cwd)

    // then
    expect(resolution.resolved).toEqual([])
    expect(resolution.missing).toEqual(["ghost"])
    expect(resolution.prepend).toBe("")
  })

  test("#given extra search dirs #when a skill lives there #then it resolves from the extra dir", () => {
    // given
    const cwd = scratch()
    const pluginRoot = scratch()
    const skillDir = join(pluginRoot, "packages", "shared-skills", "commit")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "COMMIT DIRECTIVE", "utf8")
    const loader = createFsSkillLoader({
      homeDir: scratch(),
      extraDirs: [join(pluginRoot, "packages", "shared-skills")],
    })

    // when
    const resolution = loader(["commit"], cwd)

    // then
    expect(resolution.resolved).toEqual(["commit"])
    expect(resolution.prepend).toContain("COMMIT DIRECTIVE")
  })
})
