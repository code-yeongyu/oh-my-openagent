import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { applyToolConfig } from "./tool-config-handler"
import type { OhMyOpenCodeConfig } from "../config"

function createParams(overrides: {
  taskSystem?: boolean
  agents?: string[]
  disabledTools?: string[]
}) {
  const agentResult: Record<string, { permission?: Record<string, unknown> }> = {}
  for (const agent of overrides.agents ?? []) {
    agentResult[agent] = { permission: {} }
  }

  return {
    config: { tools: {}, permission: {} } as Record<string, unknown>,
    pluginConfig: {
      experimental: overrides.taskSystem === undefined ? undefined : { task_system: overrides.taskSystem },
      disabled_tools: overrides.disabledTools,
    } as OhMyOpenCodeConfig,
    agentResult: agentResult as Record<string, unknown>,
  }
}

describe("applyToolConfig", () => {
  describe("#given config permission sets webfetch and external_directory", () => {
    describe("#when applying tool config", () => {
      it("#then should preserve explicit deny over OmO defaults", () => {
        const params = createParams({})
        params.config.permission = {
          webfetch: "deny",
          external_directory: "deny",
        }

        applyToolConfig(params)

        const permission = params.config.permission as Record<string, unknown>
        expect(permission.webfetch).toBe("deny")
        expect(permission.external_directory).toBe("deny")
        expect(permission.task).toBe("deny")
      })

      it("#then should allow webfetch and external_directory by default", () => {
        const params = createParams({})

        applyToolConfig(params)

        const permission = params.config.permission as Record<string, unknown>
        expect(permission.webfetch).toBe("allow")
        expect(permission.external_directory).toBe("allow")
        expect(permission.task).toBe("deny")
      })
    })
  })

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

  describe("#given OPENCODE_CONFIG_CONTENT has question set to deny", () => {
    let originalConfigContent: string | undefined
    let originalCliRunMode: string | undefined

    beforeEach(() => {
      originalConfigContent = process.env.OPENCODE_CONFIG_CONTENT
      originalCliRunMode = process.env.OPENCODE_CLI_RUN_MODE
    })

    afterEach(() => {
      if (originalConfigContent === undefined) {
        delete process.env.OPENCODE_CONFIG_CONTENT
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = originalConfigContent
      }
      if (originalCliRunMode === undefined) {
        delete process.env.OPENCODE_CLI_RUN_MODE
      } else {
        process.env.OPENCODE_CLI_RUN_MODE = originalCliRunMode
      }
    })

    describe("#when config explicitly denies question permission", () => {
      it.each(["sisyphus", "hephaestus", "prometheus"])(
        "#then should deny question for %s even without CLI_RUN_MODE",
        (agentName) => {
          process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
            permission: { question: "deny" },
          })
          delete process.env.OPENCODE_CLI_RUN_MODE
          const params = createParams({ agents: [agentName] })

          applyToolConfig(params)

          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("deny")
        },
      )
    })

    describe("#when config does not deny question permission", () => {
      it.each(["sisyphus", "hephaestus", "prometheus"])(
        "#then should allow question for %s in interactive mode",
        (agentName) => {
          process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
            permission: { question: "allow" },
          })
          delete process.env.OPENCODE_CLI_RUN_MODE
          const params = createParams({ agents: [agentName] })

          applyToolConfig(params)

          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("allow")
        },
      )
    })

    describe("#when CLI_RUN_MODE is true and config does not deny", () => {
      it.each(["sisyphus", "hephaestus", "prometheus"])(
        "#then should deny question for %s via CLI_RUN_MODE",
        (agentName) => {
          process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
            permission: {},
          })
          process.env.OPENCODE_CLI_RUN_MODE = "true"
          const params = createParams({ agents: [agentName] })

          applyToolConfig(params)

          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("deny")
        },
      )
    })

    describe("#when config deny overrides CLI_RUN_MODE allow", () => {
      it.each(["sisyphus", "hephaestus", "prometheus"])(
        "#then should deny question for %s when config says deny regardless of CLI_RUN_MODE",
        (agentName) => {
          process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
            permission: { question: "deny" },
          })
          process.env.OPENCODE_CLI_RUN_MODE = "false"
          const params = createParams({ agents: [agentName] })

          applyToolConfig(params)

          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("deny")
        },
      )
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

  describe("#given task_system is undefined", () => {
    describe("#when applying tool config", () => {
      it("#then should not disable todo tools globally by default", () => {
        const params = createParams({})

        applyToolConfig(params)

        const tools = params.config.tools as Record<string, unknown>
        expect(tools.todowrite).toBeUndefined()
        expect(tools.todoread).toBeUndefined()
      })

      it.each([
        "atlas",
        "sisyphus",
        "hephaestus",
        "prometheus",
        "sisyphus-junior",
      ])("#then should NOT deny todo tools for %s agent by default", (agentName) => {
        const params = createParams({
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

  describe("#given disabled_tools includes 'question'", () => {
    let originalConfigContent: string | undefined
    let originalCliRunMode: string | undefined

    beforeEach(() => {
      originalConfigContent = process.env.OPENCODE_CONFIG_CONTENT
      originalCliRunMode = process.env.OPENCODE_CLI_RUN_MODE
      delete process.env.OPENCODE_CONFIG_CONTENT
      delete process.env.OPENCODE_CLI_RUN_MODE
    })

    afterEach(() => {
      if (originalConfigContent === undefined) {
        delete process.env.OPENCODE_CONFIG_CONTENT
      } else {
        process.env.OPENCODE_CONFIG_CONTENT = originalConfigContent
      }
      if (originalCliRunMode === undefined) {
        delete process.env.OPENCODE_CLI_RUN_MODE
      } else {
        process.env.OPENCODE_CLI_RUN_MODE = originalCliRunMode
      }
    })

    describe("#when question is in disabled_tools", () => {
      it.each(["sisyphus", "hephaestus", "prometheus"])(
        "#then should deny question for %s agent",
        (agentName) => {
          const params = createParams({
            agents: [agentName],
            disabledTools: ["question"],
          })

          applyToolConfig(params)

          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("deny")
        },
      )
    })

    describe("#when question is in disabled_tools alongside other tools", () => {
      it.each(["sisyphus", "hephaestus", "prometheus"])(
        "#then should deny question for %s agent",
        (agentName) => {
          const params = createParams({
            agents: [agentName],
            disabledTools: ["todowrite", "question", "interactive_bash"],
          })

          applyToolConfig(params)

          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("deny")
        },
      )
    })

    describe("#when disabled_tools does not include question", () => {
      it.each(["sisyphus", "hephaestus", "prometheus"])(
        "#then should allow question for %s agent",
        (agentName) => {
          const params = createParams({
            agents: [agentName],
            disabledTools: ["todowrite", "interactive_bash"],
          })

          applyToolConfig(params)

          const agent = params.agentResult[agentName] as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("allow")
        },
      )
    })
  })
})
