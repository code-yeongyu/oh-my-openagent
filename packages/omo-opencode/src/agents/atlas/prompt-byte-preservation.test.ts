import { describe, expect, test } from "bun:test"
import { createAtlasAgent, type OrchestratorContext } from "./agent"

const RUNTIME_PLACEHOLDERS = [
  "{CATEGORY_SECTION}",
  "{AGENT_SECTION}",
  "{DECISION_MATRIX}",
  "{SKILLS_SECTION}",
  "{{CATEGORY_SKILLS_DELEGATION_GUIDE}}",
] as const

describe("Atlas prompt runtime section injection", () => {
  test("#given unique live context markers #when prompt renders #then placeholders are resolved", () => {
    const prompt = getAtlasPromptText({
      model: "anthropic/claude-sonnet-4-6",
      availableAgents: [
        {
          name: "unique-agent-section-marker",
          description: "UNIQUE_AGENT_SECTION_VALUE",
          metadata: {
            category: "advisor",
            cost: "EXPENSIVE",
            triggers: [{ domain: "Runtime", trigger: "Unique agent marker" }],
          },
        },
      ],
      availableSkills: [
        {
          name: "unique-guide-skill-marker",
          description: "Unique guide skill marker",
          location: "user",
        },
      ],
      userCategories: {
        "unique-category-section-marker": {
          description: "UNIQUE_CATEGORY_SECTION_VALUE",
          temperature: 0.4,
        },
      },
    })

    expect(prompt).toContain("UNIQUE_CATEGORY_SECTION_VALUE")
    expect(prompt).toContain("UNIQUE_AGENT_SECTION_VALUE")
    expect(prompt).toContain("unique-guide-skill-marker")
    for (const placeholder of RUNTIME_PLACEHOLDERS) {
      expect(prompt).not.toContain(placeholder)
    }
  })
})

function getAtlasPromptText(ctx: OrchestratorContext): string {
  const prompt = createAtlasAgent(ctx).prompt
  if (typeof prompt === "string") return prompt
  throw new TypeError("Atlas prompt must be a string")
}
