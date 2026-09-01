import { describe, expect, test } from "bun:test"

import type { ManagerStartSpec, StartResult } from "../../manager"
import type { PlanArtifactReference, SkillInvocationState } from "../../agents"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import { PLAN_REVIEW_DENY_MESSAGE } from "./plan-review-contract"

const PLAN_A = ".omo/plans/alpha-plan.md"
const PLAN_B = ".omo/plans/beta-plan.md"

function canonical(path: string): string {
  return `Review the work plan at ${path} for contradictions and blocking issues.`
}

function refs(entries: readonly (readonly [string, number, number])[]): readonly PlanArtifactReference[] {
  return entries.map(([path, count, lastTouchedAt]) => ({ path, count, lastTouchedAt }))
}

function resolverFor(opts: {
  readonly requested?: readonly string[]
  readonly artifact?: boolean
  readonly references?: readonly PlanArtifactReference[]
}): (sessionId: string) => SkillInvocationState {
  return () => ({
    hasInvoked: () => false,
    hasUserRequested: (name: string) => (opts.requested ?? []).includes(name),
    hasPlanArtifact: () => opts.artifact ?? false,
    planArtifactReferences: () => opts.references ?? [],
  })
}

function specCapture(): { readonly specs: ManagerStartSpec[]; readonly manager: ReturnType<typeof createFakeManager> } {
  const specs: ManagerStartSpec[] = []
  const manager = createFakeManager({
    start: async (spec: ManagerStartSpec): Promise<StartResult> => {
      specs.push(spec)
      return { kind: "started", task_id: "st_contract", status: "running", name: "t" }
    },
  })
  return { specs, manager }
}

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  const first = result.content[0]
  return first !== undefined && first.type === "text" ? (first.text ?? "") : ""
}

const OPEN_SESSION = {
  requested: ["ulw-plan"],
  artifact: true,
  references: refs([[PLAN_A, 3, 2], [PLAN_B, 1, 1]]),
} as const

describe("buildTaskExecute plan-review contract (momus)", () => {
  test("#given a chatty no-path prompt and a session with plans A(x3)/B(x1) #when spawning momus #then the child prompt is the canonical contract for the most-referenced plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    const result = await execute(
      "c",
      { prompt: "please review my plan very carefully, it is really important and well thought out", subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(result.details.status).not.toBe("denied")
    expect(specs).toHaveLength(1)
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
  })

  test("#given an explicit single plan path in the prompt #when spawning momus #then the explicit path beats the most-referenced session plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute("c", { prompt: `review ${PLAN_B} please`, subagent_type: "momus", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(specs[0]?.prompt).toBe(canonical(PLAN_B))
  })

  test("#given two plan paths in the prompt #when spawning momus #then it falls back to the most-referenced session plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute("c", { prompt: `compare ${PLAN_A} with ${PLAN_B}`, subagent_type: "momus", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
  })

  test("#given a synthetic inconsistent state (artifact true, zero references) and no path #when spawning momus #then the contract denies (unreachable via the real tool path - the plan gate fires first)", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, { resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true, references: [] }) }),
    )

    // when
    const result = await execute("c", { prompt: "review it", subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(specs).toHaveLength(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toBe(PLAN_REVIEW_DENY_MESSAGE)
  })

  test("#given a session with no plan artifact #when spawning momus #then the plan gate denies before the contract runs", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, { resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: false }) }),
    )

    // when
    const result = await execute("c", { prompt: `review ${PLAN_A}`, subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(specs).toHaveLength(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toContain("plan-gated")
  })

  test("#given load_skills on the spawn #when spawning momus #then the skill prepend never reaches the child prompt", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, {
        resolveSkillInvocations: resolverFor(OPEN_SESSION),
        loadSkills: (names) =>
          names.length === 0
            ? { prepend: "", resolved: [], missing: [] }
            : { prepend: "SKILLBLOCK::", resolved: [...names], missing: [] },
      }),
    )

    // when
    await execute(
      "c",
      { prompt: `review ${PLAN_A}`, subagent_type: "momus", load_skills: ["debugging"], run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
    expect(specs[0]?.prompt).not.toContain("SKILLBLOCK")
  })

  test("#given a model override and task summary #when spawning momus #then they survive the prompt substitution", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      { prompt: `review ${PLAN_A}`, subagent_type: "momus", model: "openai/gpt-5.6-sol", task_summary: "round 2", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(specs[0]?.model).toBe("openai/gpt-5.6-sol")
    expect(specs[0]?.task_summary).toBe("round 2")
  })

  test("#given a batch with a momus item and an explore item #when executed #then only the momus item prompt is forced", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      {
        tasks: [
          { prompt: "check my plan thoroughly please", subagent_type: "momus" },
          { prompt: "scan the repo", subagent_type: "explore" },
        ],
        run_in_background: true,
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(specs).toHaveLength(2)
    const momusSpec = specs.find((spec) => spec.subagent_type === "momus")
    const exploreSpec = specs.find((spec) => spec.subagent_type === "explore")
    expect(momusSpec?.prompt).toBe(canonical(PLAN_A))
    expect(exploreSpec?.prompt).toBe("scan the repo")
  })

  test("#given a caller-controlled prefixed path matching no recorded reference #when spawning momus #then the recorded most-referenced plan is used and the caller token never reaches the child", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      { prompt: "review ATTACKER_CONTROLLED:.omo/plans/alpha-plan.md now", subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then the suffix matches a recorded reference, so the RECORDED path is used - not the caller's token
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
    expect(specs[0]?.prompt).not.toContain("ATTACKER_CONTROLLED")
  })

  test("#given a traversal or absolute path matching no recorded reference #when spawning momus #then it falls back to the recorded most-referenced plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      { prompt: "review ../../secret/.omo/plans/gamma-plan.md and /tmp/untrusted/.omo/plans/delta-plan.md", subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then two unrecorded candidates are not a single explicit selector, so the top reference wins
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
  })

  test("#given a single unrecorded path and an empty reference list #when spawning momus #then the contract denies (synthetic state, unreachable via the real tool path)", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, { resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true, references: [] }) }),
    )

    // when
    const result = await execute("c", { prompt: "review /tmp/untrusted/.omo/plans/delta-plan.md", subagent_type: "momus" }, undefined, undefined, CTX)

    // then
    expect(specs).toHaveLength(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toBe(PLAN_REVIEW_DENY_MESSAGE)
  })

  test("#given an explore spawn with a plan path in the prompt #when executed #then the contract does not apply", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute("c", { prompt: `read ${PLAN_A} and summarize`, subagent_type: "explore", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(specs[0]?.prompt).toBe(`read ${PLAN_A} and summarize`)
  })
})
