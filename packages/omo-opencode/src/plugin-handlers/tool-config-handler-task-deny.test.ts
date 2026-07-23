/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { OhMyOpenCodeConfigSchema } from "../config"
import { applyToolConfig } from "./tool-config-handler"

type TestAgent = {
  permission?: Record<string, unknown>
}

const TASK_DENIED_SUBAGENTS = [
  "librarian",
  "explore",
  "oracle",
  "multimodal-looker",
  "metis",
  "momus",
] as const

const SPAWN_ALLOWED_AGENT_NAMES = [
  "sisyphus",
  "atlas",
  "prometheus",
] as const

function createParams(agentNames: readonly string[]): {
  readonly config: Record<string, unknown>
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly agentResult: Record<string, TestAgent>
} {
  const agentResult: Record<string, TestAgent> = {}
  for (const agentName of agentNames) {
    agentResult[agentName] = { permission: {} }
  }

  return {
    config: { tools: {}, permission: {} },
    pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
    agentResult,
  }
}

function requirePermission(
  agentResult: Record<string, TestAgent>,
  agentName: string,
): Record<string, unknown> {
  const permission = agentResult[agentName]?.permission
  if (!permission) {
    throw new Error(`Missing permission for ${agentName}`)
  }
  return permission
}

describe("applyToolConfig task permission hard denials", () => {
  describe("#given read-only and specialist subagents", () => {
    describe("#when applying tool config", () => {
      for (const agentName of TASK_DENIED_SUBAGENTS) {
        it(`#then should explicitly deny task for ${agentName}`, () => {
          const params = createParams([agentName])

          applyToolConfig(params)

          const permission = requirePermission(params.agentResult, agentName)
          expect(permission.task).toBe("deny")
        })
      }
    })
  })

  describe("#given librarian search permissions", () => {
    describe("#when applying tool config", () => {
      it("#then should keep grep_app allowed while task is denied", () => {
        const params = createParams(["librarian"])

        applyToolConfig(params)

        const permission = requirePermission(params.agentResult, "librarian")
        expect(permission["grep_app_*"]).toBe("allow")
        expect(permission.task).toBe("deny")
      })
    })
  })

  describe("#given coordinator and planning agents", () => {
    describe("#when applying tool config", () => {
      for (const agentName of SPAWN_ALLOWED_AGENT_NAMES) {
        it(`#then should allow spawn tools for ${agentName}`, () => {
          const params = createParams([agentName])

          applyToolConfig(params)

          const permission = requirePermission(params.agentResult, agentName)
          expect(permission.task).toBe("allow")
          expect(permission.call_omo_agent).toBe("allow")
        })
      }
    })
  })

  describe("#given Hephaestus worker", () => {
    describe("#when applying tool config", () => {
      it("#then should deny spawn tools without enabling teammate", () => {
        const params = createParams(["hephaestus"])

        applyToolConfig(params)

        const permission = requirePermission(params.agentResult, "hephaestus")
        expect(permission.task).toBe("deny")
        expect(permission.call_omo_agent).toBe("deny")
        expect(permission.look_at).toBe("deny")
        expect(permission.teammate).toBeUndefined()
      })
    })
  })

  describe("#given sisyphus-junior (factory sets task:deny)", () => {
    describe("#when applying tool config with empty initial permission", () => {
      it("#then should NOT add task:allow to sisyphus-junior (regression of #5193)", () => {
        // given sisyphus-junior with empty permission (test isolation, not factory state)
        const params = createParams(["sisyphus-junior"])

        // when
        applyToolConfig(params)

        // then permission.task must NOT be "allow" — only the other keys get added
        const permission = requirePermission(params.agentResult, "sisyphus-junior")
        expect(permission.task).toBeUndefined()
        // sanity: the other keys ARE still added
        expect(permission["task_*"]).toBe("allow")
        expect(permission.teammate).toBe("allow")
      })
    })

    describe("#when applying tool config with permission.task=deny from factory", () => {
      it("#then should NOT clobber task:deny to allow (sub-bug of #5193)", () => {
        // given sisyphus-junior with task:deny set by the factory
        const params = createParams(["sisyphus-junior"])
        const junior = params.agentResult["sisyphus-junior"] as { permission: Record<string, unknown> }
        junior.permission = { task: "deny" }

        // when
        applyToolConfig(params)

        // then task remains "deny" (not overwritten to "allow")
        expect(junior.permission.task).toBe("deny")
        // other keys are still added
        expect(junior.permission["task_*"]).toBe("allow")
        expect(junior.permission.teammate).toBe("allow")
      })
    })
  })
})
