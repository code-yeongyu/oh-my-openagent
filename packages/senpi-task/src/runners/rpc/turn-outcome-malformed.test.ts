import { describe, expect, it } from "bun:test"

import { agentEndOutcome } from "./turn-outcome"

type AgentEndEvent = Parameters<typeof agentEndOutcome>[0]

function malformedAgentEnd(overrides: Record<string, unknown>): AgentEndEvent {
  return { type: "agent_end", willRetry: false, ...overrides } as unknown as AgentEndEvent
}

describe("agentEndOutcome hostile wire payloads", () => {
  describe("#given an agent_end whose messages field is absent", () => {
    it("#when the outcome is derived #then it degrades to a terminal error instead of throwing", () => {
      // given
      const event = malformedAgentEnd({})

      // when
      const outcome = agentEndOutcome(event, undefined, undefined)

      // then
      expect(outcome.status).toBe("error")
    })
  })

  describe("#given an agent_end whose messages field is not an array", () => {
    it("#when the outcome is derived #then it degrades to a terminal error instead of throwing", () => {
      // given
      const event = malformedAgentEnd({ messages: { role: "assistant" } })

      // when
      const outcome = agentEndOutcome(event, undefined, undefined)

      // then
      expect(outcome.status).toBe("error")
    })
  })

  describe("#given an agent_end with no messages but fresh observed assistant text", () => {
    it("#when the outcome is derived #then the observed text still completes the turn", () => {
      // given
      const event = malformedAgentEnd({ messages: null })

      // when
      const outcome = agentEndOutcome(event, "old", "fresh")

      // then
      expect(outcome).toEqual({ status: "completed", finalResponse: "fresh" })
    })
  })

  describe("#given a malformed agent_end that also reports aborted", () => {
    it("#when the outcome is derived #then the abort classification is preserved", () => {
      // given
      const event = malformedAgentEnd({ aborted: true })

      // when
      const outcome = agentEndOutcome(event, undefined, undefined)

      // then
      expect(outcome.status).toBe("error")
      expect(outcome.status === "error" ? outcome.failure.kind : undefined).toBe("child-turn-failed")
    })
  })
})
