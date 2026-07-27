import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const generatedUlwPlanRoot = join(repoRoot, "packages", "omo-senpi", "plugin", "skills", "ulw-plan")
const sharedUlwPlanRoot = join(repoRoot, "packages", "shared-skills", "skills", "ulw-plan")

const REVIEW_OVERRIDE_HEADING = "## Senpi Review Override (authoritative)"
const CONSULTATION_HEADING = "## Senpi Design Consultation Lanes (authoritative)"

function readGenerated(...segments: readonly string[]): string {
  return readFileSync(join(generatedUlwPlanRoot, ...segments), "utf8")
}

function readShared(...segments: readonly string[]): string {
  return readFileSync(join(sharedUlwPlanRoot, ...segments), "utf8")
}

describe("senpi ulw-plan overlay", () => {
  describe("#given the generated senpi ulw-plan skill", () => {
    test("#when SKILL.md is read #then the review override makes the high-accuracy review momus-only", () => {
      // given / when
      const content = readGenerated("SKILL.md")

      // then
      expect(content).toContain(REVIEW_OVERRIDE_HEADING)
      expect(content).toContain("momus")
      expect(content).toContain('never spawn `task(subagent_type="oracle")`')
    })

    test("#when SKILL.md is read #then the consultation lanes name architect and ultrabrain as advisory-only", () => {
      // given / when
      const content = readGenerated("SKILL.md")

      // then
      expect(content).toContain(CONSULTATION_HEADING)
      expect(content).toContain("architect")
      expect(content).toContain("ultrabrain")
      expect(content).toContain("advisory-only")
      expect(content).toContain("run_in_background")
    })

    test("#when the override sections are located #then they precede the intent routing section they override", () => {
      // given / when
      const content = readGenerated("SKILL.md")

      // then
      expect(content.indexOf(REVIEW_OVERRIDE_HEADING)).toBeGreaterThan(-1)
      expect(content.indexOf(REVIEW_OVERRIDE_HEADING)).toBeLessThan(content.indexOf("## INTENT ROUTING"))
      expect(content.indexOf(CONSULTATION_HEADING)).toBeLessThan(content.indexOf("## INTENT ROUTING"))
    })

    test("#when the full workflow reference is read #then it also carries the momus-only review override", () => {
      // given / when
      const content = readGenerated("references", "full-workflow.md")

      // then
      expect(content).toContain(REVIEW_OVERRIDE_HEADING)
    })
  })

  describe("#given the shared ulw-plan source", () => {
    test("#when compared with the generated copy #then the shared source never carries the senpi-only override", () => {
      // given / when
      const sharedSkill = readShared("SKILL.md")
      const sharedWorkflow = readShared("references", "full-workflow.md")

      // then
      expect(sharedSkill).not.toContain(REVIEW_OVERRIDE_HEADING)
      expect(sharedSkill).not.toContain(CONSULTATION_HEADING)
      expect(sharedWorkflow).not.toContain(REVIEW_OVERRIDE_HEADING)
    })
  })
})
