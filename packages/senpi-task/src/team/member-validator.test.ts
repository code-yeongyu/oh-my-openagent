import { describe, expect, test } from "bun:test"

import { SenpiTeamSpecError } from "./errors"
import { type SenpiTeamMemberPorts, validateSenpiTeamMembers } from "./member-validator"
import { normalizeSenpiTeamSpec } from "./normalize"

const allowAll: SenpiTeamMemberPorts = {
  isCategoryResolvable: () => true,
  isKnownAgent: () => true,
}

describe("validateSenpiTeamMembers vocabulary hints", () => {
  test("#given an unknown category with named ports #when validated #then the error lists the available categories", () => {
    // given
    const spec = normalizeSenpiTeamSpec({ members: [{ kind: "category", category: "quikc", prompt: "work" }] }, "typo-team")
    const ports: SenpiTeamMemberPorts = {
      isCategoryResolvable: (category) => category === "quick" || category === "deep",
      isKnownAgent: () => true,
      categoryNames: ["deep", "quick"],
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
      expect(caught.message).toContain("Available categories: deep, quick")
    }
  })

  test("#given an unknown subagent_type with named ports #when validated #then the error lists the available agents", () => {
    // given
    const spec = normalizeSenpiTeamSpec({ members: [{ kind: "subagent_type", subagent_type: "orakel", prompt: "work" }] }, "typo-team")
    const ports: SenpiTeamMemberPorts = {
      isCategoryResolvable: () => true,
      isKnownAgent: (agent) => agent === "sisyphus",
      agentNames: ["sisyphus"],
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
      expect(caught.message).toContain("Available agents: sisyphus")
    }
  })
})

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
      { members: [{ kind: "unresolvable-kind", name: "x" }] },
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

  test("#given a curated read-only agent #when validated #then it is rejected before the known-agent check", () => {
    // given
    const spec = normalizeSenpiTeamSpec(
      { members: [{ kind: "agent", subagent_type: "momus" }] },
      "curated-agent-team",
    )

    // when
    let caught: unknown
    try {
      validateSenpiTeamMembers(spec, allowAll)
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("UNKNOWN_SUBAGENT_TYPE")
      expect(caught.message).toBe(
        'curated read-only agent "momus" cannot be a team member; delegate via the task tool instead',
      )
    }
  })
})
