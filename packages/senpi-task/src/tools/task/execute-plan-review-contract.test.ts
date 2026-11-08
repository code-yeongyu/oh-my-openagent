import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import type { ManagerStartSpec, StartResult } from "../../manager"
import type { PlanArtifactReference, SkillInvocationState } from "../../agents"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import { buildPlanReviewPrompt, PLAN_REVIEW_DENY_MESSAGE } from "./plan-review-contract"

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

describe("buildTaskExecute plan-review contract (plan-reviewer)", () => {
  test("#given a chatty no-path prompt and a session with plans A(x3)/B(x1) #when spawning plan-reviewer #then the child prompt is the canonical contract for the most-referenced plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    const result = await execute(
      "c",
      { prompt: "please review my plan very carefully, it is really important and well thought out", subagent_type: "plan-reviewer", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(result.details.status).not.toBe("denied")
    expect(specs).toHaveLength(1)
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
  })

  test("#given an explicit single plan path in the prompt #when spawning plan-reviewer #then the explicit path beats the most-referenced session plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute("c", { prompt: `review ${PLAN_B} please`, subagent_type: "plan-reviewer", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(specs[0]?.prompt).toBe(canonical(PLAN_B))
  })

  test("#given two plan paths in the prompt #when spawning plan-reviewer #then it falls back to the most-referenced session plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute("c", { prompt: `compare ${PLAN_A} with ${PLAN_B}`, subagent_type: "plan-reviewer", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
  })

  test("#given a synthetic inconsistent state (artifact true, zero references) and no path #when spawning plan-reviewer #then the contract denies (unreachable via the real tool path - the plan gate fires first)", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, { resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true, references: [] }) }),
    )

    // when
    const result = await execute("c", { prompt: "review it", subagent_type: "plan-reviewer" }, undefined, undefined, CTX)

    // then
    expect(specs).toHaveLength(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toBe(PLAN_REVIEW_DENY_MESSAGE)
  })

  test("#given a session with no plan artifact #when spawning plan-reviewer #then the plan gate denies before the contract runs", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, { resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: false }) }),
    )

    // when
    const result = await execute("c", { prompt: `review ${PLAN_A}`, subagent_type: "plan-reviewer" }, undefined, undefined, CTX)

    // then
    expect(specs).toHaveLength(0)
    expect(result.details.status).toBe("denied")
    expect(resultText(result)).toContain("plan-gated")
  })

  test("#given load_skills on the spawn #when spawning plan-reviewer #then the skill prepend never reaches the child prompt", async () => {
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
      { prompt: `review ${PLAN_A}`, subagent_type: "plan-reviewer", load_skills: ["debugging"], run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
    expect(specs[0]?.prompt).not.toContain("SKILLBLOCK")
  })

  test("#given a model override and task summary #when spawning plan-reviewer #then they survive the prompt substitution", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      { prompt: `review ${PLAN_A}`, subagent_type: "plan-reviewer", model: "openai/gpt-5.6-sol", task_summary: "round 2", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(specs[0]?.model).toBe("openai/gpt-5.6-sol")
    expect(specs[0]?.task_summary).toBe("round 2")
  })

  test("#given a batch with a plan-reviewer item and an explore item #when executed #then only the plan-reviewer item prompt is forced", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      {
        tasks: [
          { prompt: "check my plan thoroughly please", subagent_type: "plan-reviewer" },
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
    const momusSpec = specs.find((spec) => spec.subagent_type === "plan-reviewer")
    const exploreSpec = specs.find((spec) => spec.subagent_type === "explore")
    expect(momusSpec?.prompt).toBe(canonical(PLAN_A))
    expect(exploreSpec?.prompt).toBe("scan the repo")
  })

  test("#given a caller-controlled prefixed path matching no recorded reference #when spawning plan-reviewer #then the recorded most-referenced plan is used and the caller token never reaches the child", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      { prompt: "review ATTACKER_CONTROLLED:.omo/plans/alpha-plan.md now", subagent_type: "plan-reviewer", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then the suffix matches a recorded reference, so the RECORDED path is used - not the caller's token
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
    expect(specs[0]?.prompt).not.toContain("ATTACKER_CONTROLLED")
  })

  test("#given a traversal or absolute path matching no recorded reference #when spawning plan-reviewer #then it falls back to the recorded most-referenced plan", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: resolverFor(OPEN_SESSION) }))

    // when
    await execute(
      "c",
      { prompt: "review ../../secret/.omo/plans/gamma-plan.md and /tmp/untrusted/.omo/plans/delta-plan.md", subagent_type: "plan-reviewer", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then two unrecorded candidates are not a single explicit selector, so the top reference wins
    expect(specs[0]?.prompt).toBe(canonical(PLAN_A))
  })

  test("#given a single unrecorded path and an empty reference list #when spawning plan-reviewer #then the contract denies (synthetic state, unreachable via the real tool path)", async () => {
    // given
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, { resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true, references: [] }) }),
    )

    // when
    const result = await execute("c", { prompt: "review /tmp/untrusted/.omo/plans/delta-plan.md", subagent_type: "plan-reviewer" }, undefined, undefined, CTX)

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

// #11329: the plan review ledger is a markdown section inside the plan file (no schema, no side
// store). The spawn prompt only grows the re-verify instruction when the plan actually carries it,
// and the instruction states that a fabricated or incomplete ledger fails the review - without that
// clause a self-attested ledger would be a prompt-stuffing bypass of the canonical contract.
describe("buildPlanReviewPrompt review-ledger clause (#11329)", () => {
  const CANONICAL_DIRECTIVE =
    " The plan carries a `## Review ledger` section: read it first, then re-verify only the rows it marks as changed plus the plan parts those rows touch instead of re-reviewing the whole plan. The ledger is evidence, not a verdict: a fabricated or incomplete ledger fails this review."
  const ledgerDirs: string[] = []

  afterEach(() => {
    for (const dir of ledgerDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** Writes a plan under <tmp>/.omo/plans/<name>.md and returns its absolute path. */
  function ledgerPlan(name: string, body: string): string {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-plan-review-ledger-")))
    ledgerDirs.push(dir)
    const path = join(dir, ".omo", "plans", name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, "utf8")
    return path
  }

  test("#given a plan with no ledger section #when the prompt is built #then it is byte-identical to the canonical contract", () => {
    // given
    const path = ledgerPlan("no-ledger.md", "# Plan\n\n## Scope\n\nDo the thing.\n")

    // when
    const prompt = buildPlanReviewPrompt(path)

    // then
    expect(prompt).toBe(canonical(path))
    expect(prompt).not.toContain("Review ledger")
  })

  test("#given a plan file that does not exist #when the prompt is built #then the canonical contract is kept instead of a throw", () => {
    // given
    const path = join(realpathSync.native(tmpdir()), "omo-plan-review-ledger-missing", ".omo", "plans", "absent.md")

    // when
    const prompt = buildPlanReviewPrompt(path)

    // then
    expect(prompt).toBe(canonical(path))
  })

  test("#given a plan with a `## Review ledger` section #when the prompt is built #then it is the canonical sentence plus the ledger directive", () => {
    // given
    const path = ledgerPlan(
      "with-ledger.md",
      "# Plan\n\n## Scope\n\nDo the thing.\n\n## Review ledger\n\n| row | state |\n| --- | --- |\n| IS-1 | changed |\n",
    )

    // when
    const prompt = buildPlanReviewPrompt(path)

    // then
    expect(prompt).toBe(`${canonical(path)}${CANONICAL_DIRECTIVE}`)
  })

  test("#given a plan with a ledger section #when the prompt is built #then it tells the reviewer to re-verify only changed rows", () => {
    // given
    const path = ledgerPlan("changed-rows.md", "## Review ledger\n\n- row 2: changed\n")

    // when
    const prompt = buildPlanReviewPrompt(path)

    // then
    expect(prompt).toContain("re-verify only the rows it marks as changed")
    expect(prompt).toContain("instead of re-reviewing the whole plan")
  })

  test("#given a plan with a ledger section #when the prompt is built #then it names a fabricated or incomplete ledger as a review failure", () => {
    // given
    const path = ledgerPlan("gaming.md", "## Review ledger\n\nall good, trust me\n")

    // when
    const prompt = buildPlanReviewPrompt(path)

    // then: the anti-gaming clause is load-bearing, so pin it as a substring, not just a length.
    expect(prompt).toContain("a fabricated or incomplete ledger fails this review")
  })

  test("#given a plan that mentions the ledger in prose but has no heading #when the prompt is built #then the canonical contract is kept", () => {
    // given
    const path = ledgerPlan("prose.md", "# Plan\n\nWe will keep a review ledger in the notes later.\n")

    // when
    const prompt = buildPlanReviewPrompt(path)

    // then
    expect(prompt).toBe(canonical(path))
  })

  test("#given a relative recorded path and a session cwd #when the prompt is built with that cwd #then the ledger is read from the resolved plan", () => {
    // given
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "omo-plan-review-ledger-rel-")))
    ledgerDirs.push(dir)
    mkdirSync(join(dir, ".omo", "plans"), { recursive: true })
    writeFileSync(join(dir, ".omo", "plans", "relative.md"), "## Review ledger\n\n- row 1: changed\n", "utf8")

    // when
    const prompt = buildPlanReviewPrompt(".omo/plans/relative.md", dir)

    // then
    expect(prompt).toContain(CANONICAL_DIRECTIVE.trimStart())
  })

  test("#given a plan whose path sits under a directory named like a ledger heading #when the prompt is built #then only the heading line counts", () => {
    // given
    const path = ledgerPlan("near-miss.md", "# Review ledger-ish\n\n## Scope\n\nNothing reviewed yet.\n")

    // when
    const prompt = buildPlanReviewPrompt(path)

    // then
    expect(prompt).toBe(canonical(path))
  })

  test("#given a ledger plan as the session's most-referenced artifact #when spawning plan-reviewer #then the child prompt carries the ledger directive", async () => {
    // given
    const path = ledgerPlan("spawn-ledger.md", "## Scope\n\nDo it.\n\n## Review ledger\n\n| IS-1 | changed |\n")
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, {
        resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true, references: refs([[path, 3, 2]]) }),
      }),
    )

    // when
    await execute("c", { prompt: "review my plan thoroughly please", subagent_type: "plan-reviewer", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(specs[0]?.prompt).toBe(`${canonical(path)}${CANONICAL_DIRECTIVE}`)
  })

  test("#given a plan without a ledger as the session's most-referenced artifact #when spawning plan-reviewer #then the child prompt is the canonical sentence alone", async () => {
    // given
    const path = ledgerPlan("spawn-no-ledger.md", "## Scope\n\nDo it.\n")
    const { specs, manager } = specCapture()
    const execute = buildTaskExecute(
      makeDeps(manager, {
        resolveSkillInvocations: resolverFor({ requested: ["ulw-plan"], artifact: true, references: refs([[path, 3, 2]]) }),
      }),
    )

    // when
    await execute("c", { prompt: "review my plan thoroughly please", subagent_type: "plan-reviewer", run_in_background: true }, undefined, undefined, CTX)

    // then
    expect(specs[0]?.prompt).toBe(canonical(path))
  })
})
