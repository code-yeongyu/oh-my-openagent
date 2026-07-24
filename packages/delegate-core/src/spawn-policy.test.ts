import { describe, expect, test } from "bun:test"

import {
  decideSpawnAdmission,
  type SpawnCallerRole,
  type SpawnPolicyDecision,
  type SpawnPolicyInput,
  type SpawnPolicyInvalidField,
} from "./spawn-policy"

const rootInput = {
  currentDepth: 0,
  lineage: "known",
  callerRole: "coordinator",
  targetAgent: "explore",
} satisfies SpawnPolicyInput

describe("decideSpawnAdmission", () => {
  const cases = [
    ["allows direct coordinator child", rootInput, { allowed: true, policyVersion: 1, childDepth: 1, effectiveMaxDepth: 1 }],
    ["denies default-depth grandchild", { ...rootInput, currentDepth: 1 }, { allowed: false, code: "spawn_denied", reason: "depth_exceeded", policyVersion: 1, childDepth: 2, effectiveMaxDepth: 1 }],
    ["allows configured depth two", { ...rootInput, currentDepth: 1, configuredMaxDepth: 2 }, { allowed: true, policyVersion: 1, childDepth: 2, effectiveMaxDepth: 2 }],
    ["denies omitted target from allowlist", { ...rootInput, allowedSubagents: ["librarian"] }, { allowed: false, code: "spawn_denied", reason: "target_not_allowed", policyVersion: 1, childDepth: 1, effectiveMaxDepth: 1 }],
  ] as const satisfies readonly (readonly [string, SpawnPolicyInput, SpawnPolicyDecision])[]

  test.each(cases)("#given policy #when %s #then return typed decision", (_name, input, expected) => {
    expect(decideSpawnAdmission(input)).toEqual(expected)
  })

  const deniedRoles = ["worker", "reviewer", "specialist", "team_member", "leaf"] as const satisfies readonly SpawnCallerRole[]
  for (const callerRole of deniedRoles) {
    test(`#given ${callerRole} #when spawning #then deny caller`, () => {
      expect(decideSpawnAdmission({ ...rootInput, callerRole })).toMatchObject({ allowed: false, reason: "caller_not_allowed" })
    })
  }

  test.each(["unknown", "cyclic"] as const)("#given %s lineage #when spawning #then fail closed", (lineage) => {
    expect(decideSpawnAdmission({ ...rootInput, lineage })).toMatchObject({ allowed: false, reason: "unknown_lineage" })
  })

  const invalidCases = [
    [{ ...rootInput, currentDepth: -1 }, "currentDepth"],
    [{ ...rootInput, configuredMaxDepth: 3 }, "configuredMaxDepth"],
    [{ ...rootInput, callerMaxDepth: Number.NaN }, "callerMaxDepth"],
  ] as const satisfies readonly (readonly [SpawnPolicyInput, SpawnPolicyInvalidField])[]
  test.each(invalidCases)("#given invalid policy #when spawning #then deny without clamping", (input, invalidField) => {
    expect(decideSpawnAdmission(input)).toEqual({
      allowed: false,
      code: "spawn_denied",
      reason: "invalid_policy",
      policyVersion: 1,
      invalidField,
    })
  })
})
