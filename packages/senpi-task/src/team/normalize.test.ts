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

describe("normalizeSenpiTeamSpec lenient input", () => {
  test("#given a JSON-stringified spec #when normalized #then it parses and normalizes like the object form", () => {
    // given
    const payload = JSON.stringify({ members: [{ kind: "category", category: "quick", prompt: "work" }] })

    // when
    const spec = normalizeSenpiTeamSpec(payload, "string-team")

    // then
    expect(spec.name).toBe("string-team")
    expect(spec.leadAgentId).toBe(TEAM_LEAD_SENTINEL)
    expect(spec.members).toHaveLength(1)
  })

  test("#given a malformed JSON string spec #when normalized #then it rejects with the parse detail and the corrective shape", () => {
    // given / when
    let caught: unknown
    try {
      normalizeSenpiTeamSpec("{not json", "bad-string")
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("INVALID_SPEC")
      expect(caught.message).toContain("JSON")
      expect(caught.message).toContain("object")
    }
  })

  test("#given a non-string non-object spec #when normalized #then the error names the received type and the corrective shape", () => {
    // given / when
    let caught: unknown
    try {
      normalizeSenpiTeamSpec(42, "numeric")
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(SenpiTeamSpecError)
    if (caught instanceof SenpiTeamSpecError) {
      expect(caught.code).toBe("INVALID_SPEC")
      expect(caught.message).toContain("number")
      expect(caught.message).toContain("object")
    }
  })

  test("#given a single member object instead of an array #when normalized #then it is wrapped into a one-member array", () => {
    // given / when
    const spec = normalizeSenpiTeamSpec({ members: { kind: "category", category: "quick", prompt: "work" } }, "single-member")

    // then
    expect(spec.members).toHaveLength(1)
    expect(spec.members[0]?.kind).toBe("category")
  })
})

describe("normalizeSenpiTeamSpec task_summary", () => {
  test("#given a member with a task_summary #when normalized #then the summary survives the schema parse", () => {
    // given / when
    const spec = normalizeSenpiTeamSpec(
      { members: [{ kind: "category", category: "quick", prompt: "work", task_summary: "Investigate the failing test" }] },
      "demo",
    )

    // then
    expect(spec.members[0]?.task_summary).toBe("Investigate the failing test")
  })

  test("#given an over-limit member task_summary #when normalized #then it is clamped instead of rejected", () => {
    // given / when
    const spec = normalizeSenpiTeamSpec(
      { members: [{ kind: "category", category: "quick", prompt: "work", task_summary: "s".repeat(200) }] },
      "demo",
    )

    // then
    expect(spec.members[0]?.task_summary).toHaveLength(80)
    expect(spec.members[0]?.task_summary?.endsWith("...")).toBe(true)
  })
})

