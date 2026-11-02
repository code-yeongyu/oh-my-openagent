import { describe, expect, test } from "bun:test"

import type { SkillInvocationState } from "../../agents"
import type { StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import { backgroundConversionText, backgroundStartText } from "./start-presentation"

const STARTED = {
  kind: "started" as const,
  task_id: "st_00000001",
  status: "running" as const,
  name: "auditor",
}

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

describe("backgroundStartText carries no deprecation line", () => {
  test("#given any start #when the start text is built #then nothing is appended about a deprecated id", () => {
    // given / when / then
    expect(backgroundStartText(STARTED, {})).not.toContain("is deprecated")
    expect(backgroundStartText(STARTED, { taskSummary: "Audit the boundary" })).not.toContain("is deprecated")
  })

  test("#given a foreground wait converting to background #then the text stays free of deprecation lines", () => {
    // given / when
    const text = backgroundConversionText(STARTED, {}, 120)

    // then
    expect(text).toContain("continues in background")
    expect(text).not.toContain("is deprecated")
  })
})

describe("task tool start text for retired curated ids", () => {
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

  test("#given a retired subagent_type spawned in background #when the task tool executes #then the id reaches the manager verbatim with no notice", async () => {
    // given
    const startedSpecs: { subagent_type?: string }[] = []
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        startedSpecs.push({ subagent_type: spec.subagent_type })
        return { kind: "started", task_id: "st_retired_1", status: "running", name: "reviewer" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: openPlanGate() }))

    // when
    const output = await execute(
      "retired-single",
      { prompt: "Review the work plan at .omo/plans/gate-plan.md", subagent_type: "momus", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(startedSpecs).toEqual([{ subagent_type: "momus" }])
    expect(textOf(output)).toContain("Started task reviewer (st_retired_1, running)")
    expect(textOf(output)).not.toContain("is deprecated")
    expect(output.details.subagent_type).toBe("momus")
    expect(output.details).not.toHaveProperty("legacy_subagent_type")
  })

  test("#given a background batch mixing retired and canonical ids #when the task tool executes #then every id is passed through and no deprecation is listed", async () => {
    // given
    const startedSpecs: { subagent_type?: string }[] = []
    const ids = ["st_retired_a", "st_retired_b", "st_retired_c"]
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        const taskId = ids[startedSpecs.length]
        startedSpecs.push({ subagent_type: spec.subagent_type })
        return { kind: "started", task_id: taskId ?? "st_retired_x", status: "running", name: taskId ?? "member" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager, { resolveSkillInvocations: openPlanGate() }))

    // when
    const output = await execute(
      "retired-batch",
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
    expect(startedSpecs.map((spec) => spec.subagent_type)).toEqual(["momus", "metis", "plan-reviewer"])
    expect(textOf(output)).toContain("Batch running.")
    expect(textOf(output)).not.toContain("is deprecated")
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
