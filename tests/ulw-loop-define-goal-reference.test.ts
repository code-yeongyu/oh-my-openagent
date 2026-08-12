import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

const REPO_ROOT = join(import.meta.dir, "..")

const ULW_LOOP_SKILL_ROOTS = [
  join(REPO_ROOT, "packages", "omo-senpi", "skills", "ulw-loop"),
  join(REPO_ROOT, "packages", "omo-codex", "plugin", "components", "ulw-loop", "skills", "ulw-loop"),
] as const

describe("ulw-loop define-goal reference", () => {
  test.each(ULW_LOOP_SKILL_ROOTS)(
    "#given the ulw-loop skill at %s #when checking its references #then define-goal.md ships beside full-workflow.md",
    (skillRoot) => {
      // given
      const referencePath = join(skillRoot, "references", "define-goal.md")

      // then
      expect(existsSync(referencePath)).toBe(true)
    },
  )

  test.each(ULW_LOOP_SKILL_ROOTS)(
    "#given the ulw-loop SKILL.md at %s #when reading its goal instructions #then it routes goal creation through references/define-goal.md",
    (skillRoot) => {
      // given
      const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf8")

      // then
      expect(skillText).toContain("references/define-goal.md")
    },
  )

  test.each(ULW_LOOP_SKILL_ROOTS)(
    "#given the ulw-loop full-workflow at %s #when reading its goal-creation flow #then it routes objective shaping through references/define-goal.md",
    (skillRoot) => {
      // given
      const workflowText = readFileSync(join(skillRoot, "references", "full-workflow.md"), "utf8")

      // then
      expect(workflowText).toContain("define-goal.md")
    },
  )

  test("#given both shipped define-goal copies #when comparing bytes #then the senpi and codex references are identical", () => {
    // given
    const [senpiRoot, codexRoot] = ULW_LOOP_SKILL_ROOTS
    const senpiCopy = readFileSync(join(senpiRoot, "references", "define-goal.md"), "utf8")
    const codexCopy = readFileSync(join(codexRoot, "references", "define-goal.md"), "utf8")

    // then
    expect(senpiCopy).toBe(codexCopy)
  })
})
