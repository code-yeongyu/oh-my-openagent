/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createSkillTool, mockContext } from "./test-support"

describe("skill tool - bundled security skills", () => {
  it("loads security-research and security-review when the plugin skill context pre-seeds them", async () => {
    const { builtinToLoadedSkill } = await import("../../../features/opencode-skill-loader/merger/builtin-skill-converter")
    const { securityResearchSkill, securityReviewSkill } = await import("../../../features/builtin-skills/skills/index")
    const tool = createSkillTool({
      directory: "/test",
      skills: [
        builtinToLoadedSkill(securityResearchSkill),
        builtinToLoadedSkill(securityReviewSkill),
      ],
    })

    const researchResult = await tool.execute({ name: "security-research" }, mockContext)
    const reviewResult = await tool.execute({ name: "security-review" }, mockContext)

    expect(researchResult).toContain("## Skill: security-research")
    expect(researchResult).toContain("Security Research - Team Mode Vulnerability Audit")
    expect(reviewResult).toContain("## Skill: security-review")
    expect(reviewResult).toContain("Security Research - Team Mode Vulnerability Audit")
  })
})
