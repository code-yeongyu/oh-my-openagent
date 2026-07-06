import { describe, expect, test } from "bun:test"
import { atlasPromptVariants } from "./index"

describe("atlas prompt variants worktree-lifecycle guard", () => {
  const variantNames = Object.keys(atlasPromptVariants)

  test.each(variantNames)("variant %s contains worktree-lifecycle guard in <boulder_completion_response>", (variantName) => {
    const variant = atlasPromptVariants[variantName as keyof typeof atlasPromptVariants]
    const content = variant.content
    const completionStart = content.indexOf("<boulder_completion_response>")
    const completionEnd = content.indexOf("</boulder_completion_response>")

    expect(completionStart).toBeGreaterThan(-1)
    expect(completionEnd).toBeGreaterThan(completionStart)

    const completionSection = content.slice(completionStart, completionEnd)

    // The guard must mention the worktree lifecycle, the dual git status check
    // (plain + scoped ignored .omo), DIRTY, local-only, and the ancestry-is-not-proof clause.
    expect(completionSection).toContain("Worktree lifecycle guard")
    expect(completionSection).toContain("git status --short")
    expect(completionSection).toContain("git status --short --ignored -- .omo")
    expect(completionSection).toContain("EITHER output is NON-EMPTY")
    expect(completionSection).toContain("BOTH outputs are EMPTY")
    expect(completionSection).toContain("ignored `.omo/` state")
    expect(completionSection).toContain("DIRTY")
    expect(completionSection).toContain("local-only")
    // ancestry-is-not-proof clause
    const hasAncestryClause =
      completionSection.includes("Commit ancestry alone") ||
      completionSection.includes("commit ancestry alone")
    expect(hasAncestryClause).toBe(true)
  })

  test("all 7 atlas variants are covered", () => {
    expect(variantNames).toHaveLength(7)
  })
})
