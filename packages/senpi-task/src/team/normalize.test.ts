import { describe, expect, test } from "bun:test"

import { SenpiTeamSpecError } from "./errors"
import { TEAM_LEAD_SENTINEL, normalizeSenpiTeamSpec } from "./normalize"

describe("normalizeSenpiTeamSpec", () => {
  test("#given a multi-member spec with a category and an agent alias #when normalized #then it parses with the lead sentinel and no spawnable lead member", () => {
    // given
    const rawSpec = {
      members: [
        { kind: "category", category: "quick", prompt: "investigate the failing test" },
        { kind: "agent", subagent_type: "finder" },
      ],
    }

    // when
    const spec = normalizeSenpiTeamSpec(rawSpec, "research-team")

    // then
    expect(spec.name).toBe("research-team")
    expect(spec.leadAgentId).toBe(TEAM_LEAD_SENTINEL)
    expect(spec.members).toHaveLength(2)
    expect(spec.members.some((member) => member.name === TEAM_LEAD_SENTINEL)).toBe(false)
    const [first, second] = spec.members
    expect(first?.kind).toBe("category")
    expect(second?.kind).toBe("subagent_type")
    if (second?.kind === "subagent_type") {
      expect(second.subagent_type).toBe("finder")
    }
  })

  test("#given a name-less omo.json team value #when normalized #then it takes the record key as its name", () => {
    // given
    const rawSpec = { members: [{ kind: "subagent_type", subagent_type: "sisyphus" }] }

    // when
    const spec = normalizeSenpiTeamSpec(rawSpec, "solo-team")

    // then
    expect(spec.name).toBe("solo-team")
    expect(spec.leadAgentId).toBe(TEAM_LEAD_SENTINEL)
  })

  test("#given a spec that already carries its own name #when normalized #then the explicit name is preserved", () => {
    // given
    const rawSpec = { name: "explicit-name", members: [{ kind: "subagent_type", subagent_type: "atlas" }] }

    // when
    const spec = normalizeSenpiTeamSpec(rawSpec, "record-key")

    // then
    expect(spec.name).toBe("explicit-name")
  })

  test("#given a raw.lead field on the input #when normalized #then it is rejected with a typed diagnostic and zero members survive", () => {
    // given
    const rawSpec = {
      lead: { kind: "subagent_type", subagent_type: "sisyphus" },
      members: [{ kind: "category", category: "quick", prompt: "work" }],
    }

    // when
    const attempt = () => normalizeSenpiTeamSpec(rawSpec, "with-raw-lead")

    // then
    expect(attempt).toThrow(SenpiTeamSpecError)
    try {
      attempt()
    } catch (error) {
      expect(error).toBeInstanceOf(SenpiTeamSpecError)
      if (error instanceof SenpiTeamSpecError) {
        expect(error.code).toBe("RESERVED_LEAD_FIELD")
      }
    }
  })

  test("#given a member literally named 'lead' #when normalized #then it is rejected with a typed diagnostic", () => {
    // given
    const rawSpec = {
      members: [
        { kind: "subagent_type", subagent_type: "sisyphus", name: "lead" },
        { kind: "category", category: "quick", prompt: "work" },
      ],
    }

    // when
    let caught: unknown
    try {
      normalizeSenpiTeamSpec(rawSpec, "with-lead-member")
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("RESERVED_LEAD_MEMBER")
    }
  })

  test("#given the callerTeamLead option #when normalized #then it is rejected before any member is spawned", () => {
    // given
    const rawSpec = { members: [{ kind: "category", category: "quick", prompt: "work" }] }

    // when
    let caught: unknown
    try {
      normalizeSenpiTeamSpec(rawSpec, "with-caller-lead", { callerTeamLead: { agentTypeId: "sisyphus" } })
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("RESERVED_CALLER_TEAM_LEAD")
    }
  })

  test("#given a member with no resolvable kind fields #when normalized #then the schema rejects it as an invalid spec", () => {
    // given
    const rawSpec = { members: [{ kind: "agent" }] }

    // when
    let caught: unknown
    try {
      normalizeSenpiTeamSpec(rawSpec, "broken-agent")
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("INVALID_SPEC")
    }
  })
})
