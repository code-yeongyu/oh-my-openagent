import { describe, expect, test } from "bun:test"

import {
  AGENT_INVOCATION_CONDITIONS,
  EMPTY_SKILL_INVOCATIONS,
  PLAN_GATED_AGENT_NAMES,
  evaluateInvocationGuard,
  invocationConditionForAgent,
  type PlanArtifactReference,
  type SkillInvocationState,
} from "./invocation-guard"

function stateOf(opts: {
  readonly invoked?: readonly string[]
  readonly requested?: readonly string[]
  readonly artifact?: boolean
  readonly references?: readonly PlanArtifactReference[]
}): SkillInvocationState {
  return {
    hasInvoked: (name: string) => (opts.invoked ?? []).includes(name),
    hasUserRequested: (name: string) => (opts.requested ?? []).includes(name),
    hasPlanArtifact: () => opts.artifact ?? false,
    planArtifactReferences: () => opts.references ?? [],
  }
}

describe("AGENT_INVOCATION_CONDITIONS", () => {
  test("#given the classification #when inspected #then metis and momus form the plan-gated tier with the ulw-plan/artifact/ulw-execute condition", () => {
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
      expect(condition[name]?.forbidsSkills).toEqual(["ulw-execute"])
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

  test("#given a user request with artifact but ulw-execute invoked #when momus is evaluated #then it denies and names ulw-execute", () => {
    // given / when
    const verdict = evaluateInvocationGuard(
      "momus",
      stateOf({ requested: ["ulw-plan"], artifact: true, invoked: ["ulw-execute"] }),
    )

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("ulw-execute")
  })

  test("#given momus with only ulw-execute invoked #when evaluated #then the forbidden denial takes precedence over the missing requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ invoked: ["ulw-execute"] }))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") throw new Error("expected deny")
    expect(verdict.message).toContain("ulw-execute")
  })
})

describe("SkillInvocationState planArtifactReferences", () => {
  test("#given the empty skill-invocation state #when plan references are queried #then it reports none and no artifact", () => {
    // given / when / then
    expect(EMPTY_SKILL_INVOCATIONS.planArtifactReferences()).toEqual([])
    expect(EMPTY_SKILL_INVOCATIONS.hasPlanArtifact()).toBe(false)
  })

  test("#given a state built with plan references #when queried #then the widened member returns them", () => {
    // given
    const references: readonly PlanArtifactReference[] = [
      { path: "/repo/.omo/plans/alpha.md", count: 3, lastTouchedAt: 7 },
      { path: "/repo/.omo/plans/beta.md", count: 1, lastTouchedAt: 9 },
    ]

    // when
    const state = stateOf({ artifact: true, references })

    // then
    expect(state.planArtifactReferences()).toEqual(references)
  })
})

describe("evaluateInvocationGuard - denial names the real unlock path", () => {
  // The old denial forbade self-unlock but named no action that works, so agents burned repeated
  // spawns. The message must tell the model what to ask the USER for, while still refusing to let
  // the model unlock the gate itself.
  test("#given a missing user request #when momus is evaluated #then the denial names the user-driven unlock", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ artifact: true }))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") return
    expect(verdict.message).toContain("/skill:ulw-plan")
    expect(verdict.message.toLowerCase()).toContain("ask the user")
  })

  test("#given a missing plan artifact #when metis is evaluated #then the denial still names the plan-file requirement", () => {
    // given / when
    const verdict = evaluateInvocationGuard("metis", stateOf({ requested: ["ulw-plan"] }))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") return
    expect(verdict.message).toContain(".omo/plans")
  })

  test("#given ulw-execute already invoked #when momus is evaluated #then the terminal denial does not advertise an unlock", () => {
    // given / when
    const verdict = evaluateInvocationGuard("momus", stateOf({ invoked: ["ulw-execute"], requested: ["ulw-plan"], artifact: true }))

    // then
    expect(verdict.kind).toBe("deny")
    if (verdict.kind !== "deny") return
    expect(verdict.message).toContain("ulw-execute")
    expect(verdict.message).not.toContain("/skill:ulw-plan")
  })
})
