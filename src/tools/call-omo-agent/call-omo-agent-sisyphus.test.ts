import { describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import { applyToolConfig } from "../../plugin-handlers/tool-config-handler"
import { ALLOWED_AGENTS } from "./constants"

function createParams() {
  return {
    config: { tools: {}, permission: {} } as Record<string, unknown>,
    pluginConfig: {} as OhMyOpenCodeConfig,
    agentResult: {
      sisyphus: { permission: {} },
      hephaestus: { permission: {} },
    } as Record<string, { permission: Record<string, unknown> }>,
  }
}

describe("call_omo_agent Sisyphus delegation access", () => {
  test("#given built-in allowed agents #when inspecting call_omo_agent constants #then Hephaestus is callable", () => {
    expect(ALLOWED_AGENTS).toContain("hephaestus")
  })

  test("#given Sisyphus permissions and allowed agents #when applying tool config #then Sisyphus can reach Hephaestus", () => {
    const params = createParams()

    applyToolConfig(params)

    expect(ALLOWED_AGENTS).toContain("hephaestus")
    expect(params.agentResult.sisyphus.permission.call_omo_agent).toBe("allow")
    expect(params.agentResult.hephaestus.permission.call_omo_agent).toBe("deny")
  })
})
