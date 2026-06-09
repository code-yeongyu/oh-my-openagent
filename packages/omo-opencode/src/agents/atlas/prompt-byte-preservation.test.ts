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
    expectedHash: "4b3d24c5542e3d8af0a0825caa56f047ce34e5abd6ced367f988f4d7e77fb94c",
    expectedLength: 26141,
  },
  {
    variant: "gpt",
    model: "openai/gpt-5.5",
    expectedHash: "089333c55e704d19a5a7ef1b8f29633f456c0871dce84dc7b6eb8062d8ea62ab",
    expectedLength: 24795,
  },
  {
    variant: "gemini",
    model: "google/gemini-3.1-pro",
    expectedHash: "a67474b903e27eb9eddb5e5ec4303d94c255896854c9295d3149b6ed5b67aca5",
    expectedLength: 27588,
  },
  {
    variant: "kimi",
    model: "moonshotai/kimi-k2.6",
    expectedHash: "c8e5d343965d3a0af5df0bdaf3393bd24223ff89f77c910c38649656e2c2db1e",
    expectedLength: 26352,
  },
  {
    variant: "opus-4-7",
    model: "anthropic/claude-opus-4-7",
    expectedHash: "ffefdcb2ddf1b6031518b66a2e3099befd6ff29a5f72fde71284bbea7acbc945",
    expectedLength: 26974,
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
