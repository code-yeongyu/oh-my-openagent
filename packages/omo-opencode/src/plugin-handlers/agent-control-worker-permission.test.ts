import { afterEach, describe, expect, test } from "bun:test"
import type { OhMyOpenCodeConfig } from "../config"
import { applyToolConfig } from "./tool-config-handler"

const originalRole = process.env.AGENT_CONTROL_ROLE
const originalKind = process.env.AGENT_CONTROL_KIND

function restore(name: "AGENT_CONTROL_ROLE", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

describe("AgentControl worker permissions", () => {
  afterEach(() => {
    restore("AGENT_CONTROL_ROLE", originalRole)
    if (originalKind === undefined) delete process.env.AGENT_CONTROL_KIND
    else process.env.AGENT_CONTROL_KIND = originalKind
  })

  test("allows agentcontrol only for the internal worker preset", () => {
    // given
    process.env.AGENT_CONTROL_ROLE = "worker"
    process.env.AGENT_CONTROL_KIND = "explore"
    const agentResult = {
      "agentcontrol-explore": { permission: { agentcontrol: "allow", call_omo_agent: "allow" } },
      librarian: { permission: { agentcontrol: "deny" } },
    }

    // when
    applyToolConfig({
      config: {},
      pluginConfig: {} as OhMyOpenCodeConfig,
      agentResult,
    })

    // then
    expect(agentResult["agentcontrol-explore"].permission).toMatchObject({
      Report: "allow",
      agentcontrol: "deny",
      call_omo_agent: "deny",
      task: "deny",
      "task_*": "deny",
      teammate: "deny",
      write: "deny",
      webfetch: "deny",
    })
    expect(agentResult.librarian.permission.agentcontrol).toBe("deny")
  })
})
