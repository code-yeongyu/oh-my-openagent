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

const TASK_ALLOWED_AGENT_NAMES = [
  "sisyphus",
  "atlas",
  "hephaestus",
  "sisyphus-junior",
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

  describe("#given primary and executor agents", () => {
    describe("#when applying tool config", () => {
      for (const agentName of TASK_ALLOWED_AGENT_NAMES) {
        it(`#then should keep task allowed for ${agentName}`, () => {
          const params = createParams([agentName])

          applyToolConfig(params)

          const permission = requirePermission(params.agentResult, agentName)
          expect(permission.task).toBe("allow")
        })
      }
    })
  })
})
