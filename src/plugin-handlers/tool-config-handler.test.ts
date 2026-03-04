import { describe, it, expect } from "bun:test"
import { applyToolConfig } from "./tool-config-handler"
import type { OhMyOpenCodeConfig } from "../config"

function createParams(overrides: {
  taskSystem?: boolean
  agents?: string[]
}) {
  const agentResult: Record<string, { permission?: Record<string, unknown> }> = {}
  for (const agent of overrides.agents ?? []) {
    agentResult[agent] = { permission: {} }
  }

  return {
    config: { tools: {}, permission: {} } as Record<string, unknown>,
    pluginConfig: {
      experimental: { task_system: overrides.taskSystem ?? false },
    } as OhMyOpenCodeConfig,
    agentResult: agentResult as Record<string, unknown>,
  }
}

describe("applyToolConfig", () => {
  describe("#given task_system is enabled", () => {
    describe("#when applying tool config", () => {
      it("#then should deny todowrite and todoread globally", () => {
        const params = createParams({ taskSystem: true })

        applyToolConfig(params)

        const tools = params.config.tools as Record<string, unknown>
        expect(tools.todowrite).toBe(false)
        expect(tools.todoread).toBe(false)
      })

      it.each([
        "atlas",
        "sisyphus",
        "hephaestus",
        "prometheus",
        "sisyphus-junior",
      ])("#then should deny todo tools for %s agent", (agentName) => {
        const params = createParams({
          taskSystem: true,
          agents: [agentName],
        })

        applyToolConfig(params)

        const agent = params.agentResult[agentName] as {
          permission: Record<string, unknown>
        }
        expect(agent.permission.todowrite).toBe("deny")
        expect(agent.permission.todoread).toBe("deny")
      })
    })
  })

  describe("#given task_system is disabled", () => {
    describe("#when applying tool config", () => {
      it.each([
        "atlas",
        "sisyphus",
        "hephaestus",
        "prometheus",
        "sisyphus-junior",
      ])("#then should NOT deny todo tools for %s agent", (agentName) => {
        const params = createParams({
          taskSystem: false,
          agents: [agentName],
        })

        applyToolConfig(params)

        const agent = params.agentResult[agentName] as {
          permission: Record<string, unknown>
        }
        expect(agent.permission.todowrite).toBeUndefined()
        expect(agent.permission.todoread).toBeUndefined()
      })
    })
  })

  describe("#given prometheus agent", () => {
    describe("#when applying tool config", () => {
      it("#then should deny bash for prometheus", () => {
        const params = createParams({ agents: ["prometheus"] })

        applyToolConfig(params)

        const agent = params.agentResult.prometheus as {
          permission: Record<string, unknown>
        }
        expect(agent.permission.bash).toBe("deny")
      })

      it("#then should deny interactive_bash for prometheus", () => {
        const params = createParams({ agents: ["prometheus"] })

        applyToolConfig(params)

        const agent = params.agentResult.prometheus as {
          permission: Record<string, unknown>
        }
        expect(agent.permission.interactive_bash).toBe("deny")
      })

      it("#then should preserve other prometheus permissions", () => {
        const params = createParams({ agents: ["prometheus"] })

        applyToolConfig(params)

        const agent = params.agentResult.prometheus as {
          permission: Record<string, unknown>
        }
        expect(agent.permission.call_omo_agent).toBe("deny")
        expect(agent.permission.task).toBe("allow")
        expect(agent.permission["task_*"]).toBe("allow")
        expect(agent.permission.teammate).toBe("allow")
      })

      it("#then should NOT deny bash for other agents", () => {
        const otherAgents = ["atlas", "sisyphus", "hephaestus", "sisyphus-junior"]
        const params = createParams({ agents: otherAgents })

        applyToolConfig(params)

        for (const agentName of otherAgents) {
          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.bash).toBeUndefined()
          expect(agent.permission.interactive_bash).toBeUndefined()
        }
      })
    })
  })
})
