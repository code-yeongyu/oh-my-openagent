/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { createAtlasAgent } from "./atlas/agent"
import { createMetisAgent } from "./metis"
import { createMomusAgent } from "./momus"
import { createOracleAgent } from "./oracle"
import { createSisyphusAgent } from "./sisyphus"
import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-builder"

const GLM_MODEL = "zai-coding-plan/glm-5-turbo"
const NON_GLM_MODEL = "claude-opus-4-7"

const SISYPHUS_AGENTS: AvailableAgent[] = [
  {
    name: "oracle",
    description: "Architecture and failure analysis consultant",
    metadata: {
      category: "advisor",
      cost: "EXPENSIVE",
      promptAlias: "Oracle",
      triggers: [{ domain: "Architecture", trigger: "Complex design or debugging" }],
    },
  },
  {
    name: "explore",
    description: "Codebase exploration worker",
    metadata: {
      category: "exploration",
      cost: "CHEAP",
      promptAlias: "Explore",
      triggers: [{ domain: "Search", trigger: "Find code patterns" }],
    },
  },
]

const SISYPHUS_TOOLS = ["task", "background_output", "lsp_diagnostics"]

const SISYPHUS_SKILLS: AvailableSkill[] = [
  {
    name: "frontend-ui-ux",
    description: "UI implementation and UX polish",
    location: "plugin",
  },
]

const SISYPHUS_CATEGORIES: AvailableCategory[] = [
  { name: "deep", description: "Complex implementation worker" },
  { name: "visual-engineering", description: "Visual verification worker" },
]

function createSisyphusForVisionTest(model: string): AgentConfig {
  return createSisyphusAgent(
    model,
    SISYPHUS_AGENTS,
    SISYPHUS_TOOLS,
    SISYPHUS_SKILLS,
    SISYPHUS_CATEGORIES,
  )
}

function permission(agent: AgentConfig): Record<string, unknown> {
  return (agent.permission ?? {}) as Record<string, unknown>
}

const agentFactories = [
  { name: "Sisyphus", create: createSisyphusForVisionTest },
  { name: "Metis", create: createMetisAgent },
  { name: "Momus", create: createMomusAgent },
  { name: "Oracle", create: createOracleAgent },
  { name: "Atlas", create: (model: string) => createAtlasAgent({ model }) },
]

describe("GLM vision deny SDK guard", () => {
  describe("#given GLM harness agent factories", () => {
    describe("#when each factory receives a GLM model", () => {
      it("#then every returned config denies direct look_at access", () => {
        for (const factory of agentFactories) {
          const agent = factory.create(GLM_MODEL)

          expect(permission(agent).look_at, factory.name).toBe("deny")
        }
      })
    })
  })

  describe("#given GLM harness agent factories", () => {
    describe("#when each factory receives a non-GLM model", () => {
      it("#then no returned config denies direct look_at access", () => {
        for (const factory of agentFactories) {
          const agent = factory.create(NON_GLM_MODEL)

          expect(permission(agent).look_at, factory.name).not.toBe("deny")
        }
      })
    })
  })
})
