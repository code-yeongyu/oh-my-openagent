import { describe, expect, test } from "bun:test"

import {
  AGENT_INVOCATION_CONDITIONS,
  PLAN_GATED_AGENT_NAMES,
  evaluateInvocationGuard,
  invocationConditionForAgent,
  type SkillInvocationState,
} from "./invocation-guard"

function stateOf(invoked: readonly string[]): SkillInvocationState {
  return { hasInvoked: (name: string) => invoked.includes(name) }
}

describe("AGENT_INVOCATION_CONDITIONS", () => {
  test("#given the classification #when inspected #then metis and momus form the plan-gated tier with the ulw-plan/start-work condition", () => {
    // given / when
    const condition = AGENT_INVOCATION_CONDITIONS

    // then
    expect(PLAN_GATED_AGENT_NAMES.has("metis")).toBe(true)
    expect(PLAN_GATED_AGENT_NAMES.has("momus")).toBe(true)
    expect(PLAN_GATED_AGENT_NAMES.has("explore")).toBe(false)
    expect(PLAN_GATED_AGENT_NAMES.has("librarian")).toBe(false)
    for (const name of ["metis", "momus"] as const) {
      expect(condition[name]?.requiresSkills).toEqual(["ulw-plan"])
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
    const verdict = evaluateInvocationGuard("explore", stateOf([]))

    // then
    expect(verdict.kind).toBe("allow")
  })

  test("#given momus and no skill invocations #when evaluated #then it denies and names the ulw-plan requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf([]))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("momus")
    expect(verdict.message).toContain("ulw-plan")
  })

  test("#given metis and no skill invocations #when evaluated #then it denies and names the ulw-plan requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("metis", stateOf([]))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("ulw-plan")
  })

  test("#given momus and an ulw-plan invocation #when evaluated #then it allows", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf(["ulw-plan"]))

    // then
    expect(verdict.kind).toBe("allow")
  })

  test("#given momus with ulw-plan and start-work invoked #when evaluated #then it denies and names start-work", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf(["ulw-plan", "start-work"]))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("start-work")
  })

  test("#given momus with only start-work invoked #when evaluated #then the forbidden denial takes precedence over the missing requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf(["start-work"]))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("start-work")
  })
})
