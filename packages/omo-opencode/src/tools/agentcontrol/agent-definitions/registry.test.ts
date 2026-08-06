import { afterEach, describe, expect, test } from "bun:test"
import { AGENT_CONTROL_DEFINITIONS, getSelectedAgentControlDefinition } from "./registry"

const originalKind = process.env.AGENT_CONTROL_KIND

describe("AgentControl definitions", () => {
  afterEach(() => {
    if (originalKind === undefined) delete process.env.AGENT_CONTROL_KIND
    else process.env.AGENT_CONTROL_KIND = originalKind
  })

  test("uses one action identity for kind and preset suffix", () => {
    expect(Object.entries(AGENT_CONTROL_DEFINITIONS).map(([kind, definition]) => [kind, definition.preset])).toEqual([
      ["execute", "agentcontrol-execute"],
      ["explore", "agentcontrol-explore"],
      ["plan", "agentcontrol-plan"],
      ["research", "agentcontrol-research"],
      ["dispatch", "agentcontrol-dispatch"],
    ])
  })

  test("selects only a registered environment kind", () => {
    process.env.AGENT_CONTROL_KIND = "research"
    expect(getSelectedAgentControlDefinition()?.preset).toBe("agentcontrol-research")
    process.env.AGENT_CONTROL_KIND = "invalid-kind"
    expect(getSelectedAgentControlDefinition()).toBeUndefined()
  })
})
