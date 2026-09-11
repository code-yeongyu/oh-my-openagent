import { describe, expect, test } from "bun:test"

import type { SkillInvocationState } from "../../agents"
import type { StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import { appendLegacyNoticeLines, backgroundConversionText, backgroundStartText } from "./start-presentation"

const STARTED = {
  kind: "started" as const,
  task_id: "st_00000001",
  status: "running" as const,
  name: "auditor",
}

const MOMUS_NOTICE =
  'subagent_type "momus" is deprecated; use "plan-reviewer". The alias is removed in the next release.'
const METIS_NOTICE =
  'subagent_type "metis" is deprecated; use "plan-consultant". The alias is removed in the next release.'

describe("backgroundStartText", () => {
  test("#given a task_summary #when the start text is built #then the summary labels the task over description and name", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, { taskSummary: "Audit the boundary", description: "auditing" })).toContain(
      "Started task Audit the boundary (st_00000001, running)",
    )
  })

  test("#given only a description #when the start text is built #then the description labels the task", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, { description: "auditing" })).toContain("Started task auditing (st_00000001, running)")
  })

  test("#given no labels #when the start text is built #then the name is used and the id form stays stable", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, {})).toContain("Started task auditor (st_00000001, running)")
    expect(backgroundStartText({ ...STARTED, name: STARTED.task_id }, {})).toContain("Started task st_00000001 (running)")
  })
})

describe("backgroundStartText legacy curated ids", () => {
  test("#given a legacy subagent alias #when the start text is built #then one deprecation line is appended", () => {
    // given / when
    const text = backgroundStartText(STARTED, { legacyAlias: { legacy: "momus", canonical: "plan-reviewer" } })

    // then
    expect(text).toContain("Started task auditor (st_00000001, running)")
    expect(text.split("\n")).toContain(MOMUS_NOTICE)
  })

  test("#given no legacy alias #when the start text is built #then no deprecation line appears", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, {})).not.toContain("is deprecated")
  })

  test("#given a legacy subagent alias #when a foreground wait converts to background #then the notice rides along", () => {
    // given / when
    const text = backgroundConversionText(STARTED, { legacyAlias: { legacy: "momus", canonical: "plan-reviewer" } }, 120)

    // then
    expect(text).toContain("continues in background")
    expect(text.split("\n")).toContain(MOMUS_NOTICE)
  })
})

describe("appendLegacyNoticeLines", () => {
  test("#given a batch repeating one legacy id #when notices are appended #then that deprecation is listed once", () => {
    // given / when
    const text = appendLegacyNoticeLines("Batch running.", [
      { legacy: "momus", canonical: "plan-reviewer" },
      { legacy: "momus", canonical: "plan-reviewer" },
    ])

    // then
    expect(text.split("\n").filter((line) => line === MOMUS_NOTICE)).toHaveLength(1)
  })

  test("#given a batch using both legacy ids #when notices are appended #then each deprecation is listed once", () => {
    // given / when
    const text = appendLegacyNoticeLines("Batch running.", [
      { legacy: "momus", canonical: "plan-reviewer" },
      { legacy: "metis", canonical: "plan-consultant" },
    ])

    // then
    expect(text.split("\n").filter((line) => line === MOMUS_NOTICE)).toHaveLength(1)
    expect(text.split("\n").filter((line) => line === METIS_NOTICE)).toHaveLength(1)
  })

  test("#given no legacy ids #when notices are appended #then the text is unchanged", () => {
    // given / when / then
    expect(appendLegacyNoticeLines("Batch running.", [])).toBe("Batch running.")
  })
})

describe("task tool start text for legacy curated ids", () => {
  function openPlanGate(): (sessionId: string) => SkillInvocationState {
    return () => ({
      hasInvoked: (skill: string) => skill === "ulw-plan",
      hasUserRequested: (skill: string) => skill === "ulw-plan",
      hasPlanArtifact: () => true,
      planArtifactReferences: () => [{ path: ".omo/plans/gate-plan.md", count: 1, lastTouchedAt: 1 }],
    })
  }

  function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
    const first = result.content[0]
    return first !== undefined && first.type === "text" ? (first.text ?? "") : ""
  }

  test("#given a legacy subagent_type spawned in background #when the task tool executes #then the spawn is not blocked and the start text carries the notice", async () => {
    // given
    const startedSpecs: { subagent_type?: string }[] = []
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        startedSpecs.push({ subagent_type: spec.subagent_type })
        return { kind: "started", task_id: "st_legacy_1", status: "running", name: "reviewer" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: openPlanGate() }))

    // when
    const output = await execute(
      "legacy-single",
      { prompt: "Review the work plan at .omo/plans/gate-plan.md", subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(startedSpecs).toEqual([{ subagent_type: "plan-reviewer" }])
    expect(textOf(output)).toContain("Started task reviewer (st_legacy_1, running)")
    expect(textOf(output).split("\n")).toContain(MOMUS_NOTICE)
    expect(output.details.subagent_type).toBe("plan-reviewer")
    expect(output.details).toHaveProperty("legacy_subagent_type", "momus")
  })

  test("#given a background batch mixing legacy and canonical ids #when the task tool executes #then every spawn starts and each deprecation is listed once", async () => {
    // given
    const startedSpecs: { subagent_type?: string }[] = []
    const ids = ["st_legacy_a", "st_legacy_b", "st_legacy_c"]
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        const taskId = ids[startedSpecs.length]
        startedSpecs.push({ subagent_type: spec.subagent_type })
        return { kind: "started", task_id: taskId ?? "st_legacy_x", status: "running", name: taskId ?? "member" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: openPlanGate() }))

    // when
    const output = await execute(
      "legacy-batch",
      {
        run_in_background: true,
        tasks: [
          { prompt: "Review the work plan at .omo/plans/gate-plan.md", subagent_type: "momus" },
          { prompt: "Consult on the work plan at .omo/plans/gate-plan.md", subagent_type: "metis" },
          { prompt: "Review the work plan at .omo/plans/gate-plan.md", subagent_type: "plan-reviewer" },
        ],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(startedSpecs.map((spec) => spec.subagent_type)).toEqual(["plan-reviewer", "plan-consultant", "plan-reviewer"])
    expect(textOf(output)).toContain("Batch running.")
    expect(textOf(output).split("\n").filter((line) => line === MOMUS_NOTICE)).toHaveLength(1)
    expect(textOf(output).split("\n").filter((line) => line === METIS_NOTICE)).toHaveLength(1)
  })

  test("#given a canonical subagent_type spawned in background #when the task tool executes #then no deprecation notice appears", async () => {
    // given
    const calls = { count: 0 }
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        calls.count += 1
        return { kind: "started", task_id: "st_canon_1", status: "running", name: "reviewer" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: openPlanGate() }))

    // when
    const output = await execute(
      "canonical-single",
      { prompt: "Review the work plan at .omo/plans/gate-plan.md", subagent_type: "plan-reviewer", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(calls.count).toBe(1)
    expect(textOf(output)).not.toContain("is deprecated")
    expect(output.details).not.toHaveProperty("legacy_subagent_type")
  })
})
