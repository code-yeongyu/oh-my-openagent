import { describe, expect, it } from "bun:test"
import { deduplicatePathAliasedSkills, formatCombinedDescription } from "./description-formatter"
import type { SkillInfo } from "./types"

function makeSkill(name: string, description = "desc"): SkillInfo {
  return { name, description, scope: "builtin" }
}

describe("deduplicatePathAliasedSkills", () => {
  it("keeps all skills when there are no path-alias duplicates", () => {
    const skills = [makeSkill("debugging"), makeSkill("review-work"), makeSkill("git-master")]
    expect(deduplicatePathAliasedSkills(skills).map((s) => s.name)).toEqual([
      "debugging",
      "review-work",
      "git-master",
    ])
  })

  it("suppresses the bare short name when a qualified variant exists", () => {
    const skills = [
      makeSkill("shared/debugging"),
      makeSkill("debugging"), // duplicate alias — should be removed
      makeSkill("review-work"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual(["shared/debugging", "review-work"])
  })

  it("handles multiple short-name duplicates in one pass", () => {
    const skills = [
      makeSkill("shared/debugging"),
      makeSkill("debugging"),
      makeSkill("shared/remove-ai-slops"),
      makeSkill("remove-ai-slops"),
      makeSkill("review-work"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual([
      "shared/debugging",
      "shared/remove-ai-slops",
      "review-work",
    ])
  })

  it("keeps the qualified name even when descriptions differ", () => {
    const skills = [
      makeSkill("shared/debugging", "canonical description"),
      makeSkill("debugging", "slightly different description"),
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("shared/debugging")
    expect(result[0]?.description).toBe("canonical description")
  })

  it("does not suppress a bare name that has no qualified counterpart", () => {
    const skills = [
      makeSkill("shared/debugging"),
      makeSkill("review-work"), // no shared/review-work exists
    ]
    const result = deduplicatePathAliasedSkills(skills)
    expect(result.map((s) => s.name)).toEqual(["shared/debugging", "review-work"])
  })

  it("handles deeply nested paths correctly", () => {
    const skills = [
      makeSkill("org/team/debugging"),
      makeSkill("debugging"), // should be suppressed
      makeSkill("team/debugging"), // different qualified path — kept; but short name already suppressed
    ]
    const result = deduplicatePathAliasedSkills(skills)
    // "debugging" bare name suppressed; both qualified variants kept
    expect(result.map((s) => s.name)).toEqual(["org/team/debugging", "team/debugging"])
  })
})

describe("formatCombinedDescription with path-alias deduplication", () => {
  it("omits the bare alias from the injected description", () => {
    const skills: SkillInfo[] = [
      makeSkill("shared/debugging"),
      makeSkill("debugging"),
      makeSkill("review-work"),
    ]
    const result = formatCombinedDescription(skills, [], { includeSkills: true })
    expect(result).toContain("/shared/debugging")
    expect(result).not.toContain("\n    <name>/debugging</name>")
    expect(result).toContain("/review-work")
  })
})
