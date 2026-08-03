import { describe, expect, test } from "bun:test"

import {
  AGENT_INVOCATION_CONDITIONS,
  PLAN_GATED_AGENT_NAMES,
  evaluateInvocationGuard,
  invocationConditionForAgent,
  type SkillInvocationState,
} from "./invocation-guard"

function stateOf(opts: {
  readonly invoked?: readonly string[]
  readonly requested?: readonly string[]
  readonly artifact?: boolean
}): SkillInvocationState {
  return {
    hasInvoked: (name: string) => (opts.invoked ?? []).includes(name),
    hasUserRequested: (name: string) => (opts.requested ?? []).includes(name),
    hasPlanArtifact: () => opts.artifact ?? false,
  }
}

describe("AGENT_INVOCATION_CONDITIONS", () => {
  test("#given the classification #when inspected #then metis and momus form the plan-gated tier with the ulw-plan/artifact/start-work condition", () => {
    // given / when
    const condition = AGENT_INVOCATION_CONDITIONS

    // then
    expect(PLAN_GATED_AGENT_NAMES.has("metis")).toBe(true)
    expect(PLAN_GATED_AGENT_NAMES.has("momus")).toBe(true)
    expect(PLAN_GATED_AGENT_NAMES.has("explore")).toBe(false)
    expect(PLAN_GATED_AGENT_NAMES.has("librarian")).toBe(false)
    for (const name of ["metis", "momus"] as const) {
      expect(condition[name]?.requiresSkills).toEqual(["ulw-plan"])
      expect(condition[name]?.requiresPlanArtifact).toBe(true)
      expect(condition[name]?.forbidsSkills).toEqual(["start-work"])
    }
  })

  test("#given a non-gated agent #when its condition is queried #then none is registered", () => {
    // given / when / then
    expect(invocationConditionForAgent("explore")).toBeUndefined()
    expect(invocationConditionForAgent("sisyphus")).toBeUndefined()
  })
})

describe("evaluateInvocationGuard", () => {
  test("#given a non-gated agent #when evaluated with an empty session #then it allows", () => {
    // given / when
    const verdict = evaluateInvocationGuard("explore", stateOf({}))

    // then
    expect(verdict.kind).toBe("allow")
  })

  test("#given momus and an empty session #when evaluated #then it denies and names the ulw-plan requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({}))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("momus")
    expect(verdict.message).toContain("ulw-plan")
  })

  test("#given metis and an empty session #when evaluated #then it denies and names the ulw-plan requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("metis", stateOf({}))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("ulw-plan")
  })

  test("#given only a SKILL.md-read invocation without a user request #when momus is evaluated #then it denies even with an artifact", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ invoked: ["ulw-plan"], artifact: true }))

    // then
    expect(verdict.kind).toBe("deny")
  })

  test("#given a missing user request #when momus is denied #then the message carries no self-unlock coaching", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ invoked: ["ulw-plan"], artifact: true }))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).not.toContain("SKILL.md")
    expect(verdict.message).not.toContain("/skill:")
  })

  test("#given a user request without a plan artifact #when momus is evaluated #then it denies naming the plan artifact", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ requested: ["ulw-plan"] }))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain(".omo/plans")
  })

  test("#given a user request and a plan artifact #when momus is evaluated #then it allows", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ requested: ["ulw-plan"], artifact: true }))

    // then
    expect(verdict.kind).toBe("allow")
  })

  test("#given a user request with artifact but start-work invoked #when momus is evaluated #then it denies and names start-work", () => {
    // given / when
    const verdict = evaluateInvocationGuard(
      "momus",
      stateOf({ requested: ["ulw-plan"], artifact: true, invoked: ["start-work"] }),
    )

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("start-work")
  })

  test("#given momus with only start-work invoked #when evaluated #then the forbidden denial takes precedence over the missing requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ invoked: ["start-work"] }))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("start-work")
  })
})
