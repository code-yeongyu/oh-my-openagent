import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { createAtlasAgent, type AtlasPromptSource, type OrchestratorContext } from "./agent"

type VariantPromptCase = {
  readonly variant: AtlasPromptSource
  readonly model: string
  readonly expectedHash: string
  readonly expectedLength: number
}

const BASE_CONTEXT = {
  availableAgents: [
    {
      name: "oracle",
      description: "Read-only architecture reviewer",
      metadata: {
        category: "advisor",
        cost: "EXPENSIVE",
        triggers: [{ domain: "Architecture", trigger: "Need design review" }],
        promptAlias: "Oracle",
      },
    },
    {
      name: "explore",
      description: "Fast codebase searcher",
      metadata: {
        category: "exploration",
        cost: "CHEAP",
        triggers: [{ domain: "Code search", trigger: "Need repository context" }],
        promptAlias: "Explore",
      },
    },
  ],
  availableSkills: [
    {
      name: "programming",
      description: "Strict TypeScript implementation discipline",
      location: "user",
    },
    {
      name: "git-master",
      description: "Atomic git operations",
      location: "plugin",
    },
    {
      name: "frontend-ui-ux",
      description: "Premium UI guidance",
      location: "project",
    },
  ],
  userCategories: {
    custom: { description: "Custom deterministic category", temperature: 0.7 },
    quick: { description: "User quick override", temperature: 0.2 },
  },
} satisfies OrchestratorContext

const VARIANT_PROMPT_CASES = [
  {
    variant: "default",
    model: "anthropic/claude-sonnet-4-6",
    expectedHash: "b29612f266994284487c37342c8e253f158b5d08daf95266e71651cbfcf1b9f9",
    expectedLength: 25847,
  },
  {
    variant: "gpt",
    model: "openai/gpt-5.5",
    expectedHash: "187a6d5f63dd166c88b568e9c2e142205eb4d8537386e1c81a38707e4ac59efb",
    expectedLength: 24707,
  },
  {
    variant: "gemini",
    model: "google/gemini-3.1-pro",
    expectedHash: "194f4508da8c5a885a44a8d253cb6f6504190cf60d634cc42801a794bc4c8d33",
    expectedLength: 27579,
  },
  {
    variant: "kimi",
    model: "moonshotai/kimi-k2.6",
    expectedHash: "2d1d3e3fb665493e624f5d810a693e2df637346b3dab7800b9a689b6ed7932bf",
    expectedLength: 26107,
  },
  {
    variant: "opus-4-7",
    model: "anthropic/claude-opus-4-7",
    expectedHash: "353bd5d9ceaeb2b4eb53cb851d65d206a777643c6542505ab32e0bd1993c3de2",
    expectedLength: 26729,
  },
] satisfies readonly VariantPromptCase[]

const RUNTIME_PLACEHOLDERS = [
  "{CATEGORY_SECTION}",
  "{AGENT_SECTION}",
  "{DECISION_MATRIX}",
  "{SKILLS_SECTION}",
  "{{CATEGORY_SKILLS_DELEGATION_GUIDE}}",
] as const

describe("Atlas prompt byte preservation", () => {
  for (const promptCase of VARIANT_PROMPT_CASES) {
    test(`#given ${promptCase.variant} model #when Atlas prompt renders #then hash matches the baseline`, () => {
      const prompt = getAtlasPromptText({ ...BASE_CONTEXT, model: promptCase.model })

      expect(createHash("sha256").update(prompt).digest("hex")).toBe(promptCase.expectedHash)
      expect(prompt.length).toBe(promptCase.expectedLength)
    })
  }
})

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
