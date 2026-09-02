import { describe, expect, test } from "bun:test"

import { buildMemberPromptBody } from "./member-session-routing"
import type { RuntimeStateMember } from "./types"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"

function createMember(overrides: Partial<RuntimeStateMember> = {}): RuntimeStateMember {
  return {
    name: "scout",
    kind: "subagent_type",
    subagent_type: "sisyphus-junior",
    sessionID: "member-session-1",
    ...overrides,
  } as RuntimeStateMember
}

describe("buildMemberPromptBody — OpenCode synthetic marking (#5544)", () => {
  test("#given a member envelope is delivered live #when the prompt body is built #then its text part is synthetic so OpenCode's ensureTitle real-user count is not defeated", () => {
    // given
    const member = createMember()

    // when
    const body = buildMemberPromptBody(member, "check the failing test")

    // then
    expect(body.parts).toHaveLength(1)
    const part = body.parts[0]
    expect(part.type).toBe("text")
    expect(part.synthetic).toBe(true)
    expect(part.text).toContain("check the failing test")
    expect(part.text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })

  test("#given a member with routing metadata #when the prompt body is built #then agent, model, and tuning fields are preserved alongside the synthetic part", () => {
    // given
    const member = createMember({
      model: {
        providerID: "anthropic",
        modelID: "claude-sonnet-5",
        variant: "high",
        temperature: 0.2,
        top_p: 0.9,
        maxTokens: 8192,
      },
    } as Partial<RuntimeStateMember> as RuntimeStateMember)

    // when
    const body = buildMemberPromptBody(member, "do the work")

    // then
    expect(body.agent).toBe("sisyphus-junior")
    expect(body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5" })
    expect(body.variant).toBe("high")
    expect(body.temperature).toBe(0.2)
    expect(body.topP).toBe(0.9)
    expect(body.maxOutputTokens).toBe(8192)
    expect(body.parts[0]?.synthetic).toBe(true)
  })
})
