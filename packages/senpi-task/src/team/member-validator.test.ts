import { describe, expect, test } from "bun:test"

import { SenpiTeamSpecError } from "./errors"
import { type SenpiTeamMemberPorts, validateSenpiTeamMembers } from "./member-validator"
import { normalizeSenpiTeamSpec } from "./normalize"

const allowAll: SenpiTeamMemberPorts = {
  isCategoryResolvable: () => true,
  isKnownAgent: () => true,
}

describe("validateSenpiTeamMembers", () => {
  test("#given resolvable members #when validated #then it passes without throwing", () => {
    // given
    const spec = normalizeSenpiTeamSpec(
      {
        members: [
          { kind: "category", category: "quick", prompt: "work" },
          { kind: "agent", subagent_type: "finder" },
        ],
      },
      "research-team",
    )

    // when
    const attempt = () => validateSenpiTeamMembers(spec, allowAll)

    // then
    expect(attempt).not.toThrow()
  })

  test("#given an unresolvable category #when validated #then it throws naming the allowed kinds", () => {
    // given
    const spec = normalizeSenpiTeamSpec(
      { members: [{ kind: "oracle-like-unknown", name: "x" }] },
      "bad-category-team",
    )
    const ports: SenpiTeamMemberPorts = {
      isCategoryResolvable: () => false,
      isKnownAgent: () => true,
    }

    // when
    let caught: unknown
    try {
      validateSenpiTeamMembers(spec, ports)
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("UNRESOLVABLE_CATEGORY")
      expect(caught.message).toContain("category")
      expect(caught.message).toContain("subagent_type")
      expect(caught.message).toContain("agent")
    }
  })

  test("#given an unknown subagent_type #when validated #then it throws a typed diagnostic", () => {
    // given
    const spec = normalizeSenpiTeamSpec(
      { members: [{ kind: "agent", subagent_type: "not-loaded" }] },
      "bad-agent-team",
    )
    const ports: SenpiTeamMemberPorts = {
      isCategoryResolvable: () => true,
      isKnownAgent: () => false,
    }

    // when
    let caught: unknown
    try {
      validateSenpiTeamMembers(spec, ports)
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("UNKNOWN_SUBAGENT_TYPE")
    }
  })
})
