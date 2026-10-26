import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "os"
import type { SkillDiagnostic } from "./skill-provenance"

describe("loadSkillsFromDir missing directories", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "missing-skill-dir-test-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it("#given a skills dir that does not exist #when loadSkillsFromDir runs #then it returns no skills and reports no diagnostic", async () => {
    //#given
    const missingDir = join(testDir, "does-not-exist", "skills")
    const diagnostics: SkillDiagnostic[] = []
    const { loadSkillsFromDir } = await import("./skill-directory-loader")

    //#when
    const skills = await loadSkillsFromDir({
      skillsDir: missingDir,
      scope: "user",
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })

    //#then
    expect(skills).toEqual([])
    expect(diagnostics).toEqual([])
  })
})
