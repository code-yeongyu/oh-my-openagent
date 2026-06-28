import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { applyToolConfig } from "./tool-config-handler"
import type { OhMyOpenCodeConfig } from "../config"
import * as shared from "../shared"
import { getAgentDisplayName } from "../shared/agent-display-names"

function createParams(overrides: {
  taskSystem?: boolean
  agents?: string[]
  disabledTools?: string[]
  externalMcpAllowlist?: Record<string, string[]>
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
      external_mcp_allowlist: overrides.externalMcpAllowlist,
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

    describe("#when OPENCODE_CONFIG_CONTENT parsing throws a non-Error value", () => {
      it("#then should fall back to interactive question permission", () => {
        // given
        const parseSpy = spyOn(JSON, "parse").mockImplementation(() => {
          throw "parse failed"
        })
        process.env.OPENCODE_CONFIG_CONTENT = "{"
        delete process.env.OPENCODE_CLI_RUN_MODE
        const params = createParams({ agents: ["sisyphus"] })

        try {
          // when
          applyToolConfig(params)

          // then
          const agent = params.agentResult.sisyphus as {
            permission: Record<string, unknown>
          }
          expect(agent.permission.question).toBe("allow")
        } finally {
          parseSpy.mockRestore()
        }
      })
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

  describe("#given external MCP policy", () => {
    describe("#when no opt-in allowlist is configured", () => {
      it("#then should keep codegraph tools denied by default", () => {
        const params = createParams({ agents: ["explore"] })

        applyToolConfig(params)

        const tools = params.config.tools as Record<string, unknown>
        const explore = params.agentResult.explore as { permission: Record<string, unknown> }
        expect(tools["codegraph_*"]).toBe(false)
        expect(explore.permission["codegraph_*"]).toBeUndefined()
      })
    })

    describe("#when selected read-only subagents opt in to codegraph", () => {
      it("#then should grant only the configured external MCP pattern to those subagents", () => {
        const params = createParams({
          agents: ["explore", "librarian", "oracle"],
          externalMcpAllowlist: {
            explore: ["codegraph_*"],
            librarian: ["codegraph_*"],
            oracle: ["codegraph_*"],
          },
        })

        applyToolConfig(params)

        const tools = params.config.tools as Record<string, unknown>
        expect(tools["codegraph_*"]).toBe(false)
        for (const agentName of ["explore", "librarian", "oracle"]) {
          const agent = params.agentResult[agentName] as { permission: Record<string, unknown> }
          expect(agent.permission["codegraph_*"]).toBe("allow")
        }
      })
    })

    describe("#when an allowlist targets unsupported agents or tools", () => {
      it("#then should leave the tool absent from agent permissions and log a warning", () => {
        const logSpy = spyOn(shared, "log").mockImplementation(() => {})
        const params = createParams({
          agents: ["hephaestus", "explore"],
          externalMcpAllowlist: {
            hephaestus: ["codegraph_*"],
            explore: ["context7_*"],
          },
        })

        try {
          applyToolConfig(params)

          const hephaestus = params.agentResult.hephaestus as { permission: Record<string, unknown> }
          const explore = params.agentResult.explore as { permission: Record<string, unknown> }
          expect(hephaestus.permission["codegraph_*"]).toBeUndefined()
          expect(explore.permission["context7_*"]).toBeUndefined()
          expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('external MCP allowlist ignored for unsupported subagent "hephaestus"'),
          )
          expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('external MCP allowlist ignored unsupported tool pattern "context7_*"'),
          )
        } finally {
          logSpy.mockRestore()
        }
      })
    })
  })

  describe("#given agentResult uses clean display keys", () => {
    it("#then should still resolve atlas permissions through the display key", () => {
      const atlasKey = getAgentDisplayName("atlas")
      const params = createParams({ agents: [atlasKey] })

      applyToolConfig(params)

      const agent = params.agentResult[atlasKey] as {
        permission: Record<string, unknown>
      }
      expect(agent.permission.task).toBe("allow")
      expect(agent.permission["task_*"]).toBe("allow")
      expect(agent.permission.teammate).toBe("allow")
    })

    it("#then should allow teammate for hephaestus", () => {
      // given
      const params = createParams({ agents: ["hephaestus"] })

      // when
      applyToolConfig(params)

      // then
      const agent = params.agentResult.hephaestus as {
        permission: Record<string, unknown>
      }
      expect(agent.permission.teammate).toBe("allow")
    })
  })

  describe("#given sisyphus-junior with permission.task=deny from factory", () => {
    describe("#when applyToolConfig runs", () => {
      it("#then should NOT clobber task:deny to allow (sub-bug of #5193)", () => {
        // given a sisyphus-junior agent with permission.task === "deny" (factory output)
        const params = createParams({ agents: ["sisyphus-junior"] });
        (params.agentResult["sisyphus-junior"] as { permission: Record<string, unknown> }).permission = {
          task: "deny",
        };

        // when applyToolConfig runs
        applyToolConfig(params);

        // then task remains "deny" (NOT overwritten to "allow")
        const junior = params.agentResult["sisyphus-junior"] as {
          permission: Record<string, unknown>;
        };
        expect(junior.permission.task).toBe("deny");
      });

      it("#then should still add task_*:allow and teammate:allow to sisyphus-junior", () => {
        // given
        const params = createParams({ agents: ["sisyphus-junior"] });
        (params.agentResult["sisyphus-junior"] as { permission: Record<string, unknown> }).permission = {
          task: "deny",
        };

        // when
        applyToolConfig(params);

        // then
        const junior = params.agentResult["sisyphus-junior"] as {
          permission: Record<string, unknown>;
        };
        expect(junior.permission["task_*"]).toBe("allow");
        expect(junior.permission.teammate).toBe("allow");
      });
    });
  });

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
