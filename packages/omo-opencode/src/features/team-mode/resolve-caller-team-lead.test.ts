/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { resolveCallerTeamLead, shouldReuseCallerLeadSession } from "./resolve-caller-team-lead"
import type { TeamSpec } from "./types"

function makeSpec(overrides: Partial<TeamSpec> = {}): TeamSpec {
  return {
    version: 1,
    name: "test-team",
    createdAt: Date.now(),
    leadAgentId: "lead",
    members: [
      { kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true },
      { kind: "category", name: "worker", category: "quick", prompt: "do work", backendType: "in-process", isActive: true },
    ],
    ...overrides,
  }
}

describe("resolveCallerTeamLead", () => {
  const builtinSisyphus = [{ name: "Sisyphus - ultraworker", native: true }] as const

  test("returns an eligible sisyphus lead for the plain display name", () => {
    // given
    const rawAgentName = "Sisyphus"

    // when
    const result = resolveCallerTeamLead(rawAgentName, builtinSisyphus)

    // then
    expect(result).toEqual({
      agentTypeId: "sisyphus",
      displayName: "Sisyphus",
      isEligibleForTeamLead: true,
    })
  })

  test("returns an eligible sisyphus lead for the suffixed display name", () => {
    // given
    const rawAgentName = "Sisyphus - Ultraworker"

    // when
    const result = resolveCallerTeamLead(rawAgentName, builtinSisyphus)

    // then
    expect(result).toEqual({
      agentTypeId: "sisyphus",
      displayName: "Sisyphus - ultraworker",
      isEligibleForTeamLead: true,
    })
  })

  test("strips visible ordering prefixes before resolving the caller lead", () => {
    // given
    const rawAgentName = "00|Sisyphus"

    // when
    const result = resolveCallerTeamLead(rawAgentName, builtinSisyphus)

    // then
    expect(result).toEqual({
      agentTypeId: "sisyphus",
      displayName: "Sisyphus",
      isEligibleForTeamLead: true,
    })
  })

  test("returns not eligible when the caller agent is undefined", () => {
    // given
    const rawAgentName = undefined

    // when
    const result = resolveCallerTeamLead(rawAgentName, [{ name: "oracle", native: true }])

    // then
    expect(result).toEqual({ isEligibleForTeamLead: false })
  })

  test("returns not eligible for read-only agents", () => {
    // given
    const rawAgentName = "Oracle"

    // when
    const result = resolveCallerTeamLead(rawAgentName, [{ name: "oracle", native: true }])

    // then
    expect(result).toEqual({
      displayName: "Oracle",
      isEligibleForTeamLead: false,
    })
  })

  for (const native of [false, undefined] as const) {
    test(`accepts the protected OMO final-registry identity when native is ${String(native)}`, () => {
      // given
      const finalRegistry = [{ name: "Sisyphus - ultraworker", native }] as const

      // when
      const result = resolveCallerTeamLead("Sisyphus", finalRegistry)

      // then
      expect(result).toMatchObject({ agentTypeId: "sisyphus", isEligibleForTeamLead: true })
    })
  }

  test("rejects a prefixed protected caller when the OMO identity is absent after collision filtering", () => {
    // given
    const finalRegistry = [{ name: "repository-reviewer", native: false }] as const

    // when
    const result = resolveCallerTeamLead("1|Sisyphus - ultraworker", finalRegistry)

    // then
    expect(result).toEqual({
      displayName: "Sisyphus - ultraworker",
      isEligibleForTeamLead: false,
    })
  })

  test("fails closed when the protected final registry identity is ambiguous", () => {
    // given
    const finalRegistry = [
      { name: "Sisyphus - ultraworker", native: false },
      { name: "Sisyphus - ultraworker", native: undefined },
    ] as const

    // when
    const result = resolveCallerTeamLead("Sisyphus", finalRegistry)

    // then
    expect(result).toEqual({ displayName: "Sisyphus", isEligibleForTeamLead: false })
  })

  test("accepts a configured display alias when its exact protected identity exists", () => {
    // given
    const finalRegistry = [{ name: "总指挥", native: false }] as const

    // when
    const result = resolveCallerTeamLead("总指挥", finalRegistry, {
      sisyphus: { displayName: "总指挥" },
    })

    // then
    expect(result).toEqual({
      agentTypeId: "sisyphus",
      displayName: "总指挥",
      isEligibleForTeamLead: true,
    })
  })

  test("requires final-registry provenance for a legacy built-in alias", () => {
    // when
    const result = resolveCallerTeamLead("Sisyphus (Ultraworker)", builtinSisyphus)

    // then
    expect(result.agentTypeId).toBe("sisyphus")
    expect(result.isEligibleForTeamLead).toBe(true)
  })
})

describe("shouldReuseCallerLeadSession", () => {
  test("reuses caller session when caller is eligible and spec has a lead", () => {
    // given
    const spec = makeSpec({ leadAgentId: "lead" })

    // when
    const result = shouldReuseCallerLeadSession(spec, "sisyphus")

    // then
    expect(result).toBe(true)
  })

  test("reuses caller session even when lead member is category type", () => {
    // given
    const spec = makeSpec({
      leadAgentId: "lead",
      members: [
        { kind: "category", name: "lead", category: "deep", prompt: "lead the team", backendType: "in-process", isActive: true },
        { kind: "category", name: "worker", category: "quick", prompt: "do work", backendType: "in-process", isActive: true },
      ],
    })

    // when
    const result = shouldReuseCallerLeadSession(spec, "sisyphus")

    // then
    expect(result).toBe(true)
  })

  test("reuses caller session even when lead subagent_type differs from caller", () => {
    // given
    const spec = makeSpec({
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "atlas", backendType: "in-process", isActive: true },
      ],
    })

    // when
    const result = shouldReuseCallerLeadSession(spec, "sisyphus")

    // then
    expect(result).toBe(true)
  })

  test("does not reuse when callerAgentTypeId is undefined", () => {
    // given
    const spec = makeSpec({ leadAgentId: "lead" })

    // when
    const result = shouldReuseCallerLeadSession(spec, undefined)

    // then
    expect(result).toBe(false)
  })

  test("does not reuse when spec has no leadAgentId", () => {
    // given
    const spec = makeSpec({ leadAgentId: undefined })

    // when
    const result = shouldReuseCallerLeadSession(spec, "sisyphus")

    // then
    expect(result).toBe(false)
  })
})
