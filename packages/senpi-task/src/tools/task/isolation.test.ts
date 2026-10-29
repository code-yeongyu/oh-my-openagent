import { describe, expect, test } from "bun:test"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { Value } from "typebox/value"
import { normalizeTaskToolArguments } from "./argument-normalization"
import { taskCallLines } from "./call-renderer"
import { buildTaskExecute } from "./execute"
import { singleSpawnParams, buildStartSpec } from "./execute-spec"
import { TaskToolParams } from "./params"
import { resolveSpawnItems } from "./validation"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"

import type { StartResult } from "../../manager"

function startedManager() {
  return createFakeManager({
    start: async (): Promise<StartResult> => ({ kind: "started", task_id: "st_00000099", status: "running", name: "isolation-task" }),
  })
}

describe("isolation task parameters", () => {
  test("rejects string booleans through normalization and schema validation", () => {
    expect(Value.Check(TaskToolParams, { prompt: "Inspect", category: "quick", isolated: "yes" })).toBe(false)
    expect(() => normalizeTaskToolArguments({ prompt: "Inspect", category: "quick", isolated: "yes" })).toThrow()
    expect(() => normalizeTaskToolArguments({ category: "quick", tasks: [{ prompt: "Inspect", apply: "no" }] })).toThrow()
  })

  test("batch inherits isolation options and preserves explicit false", () => {
    const prepared = normalizeTaskToolArguments({
      isolated: true, apply: false, merge: "branch", category: "quick",
      tasks: [{ prompt: "First" }, { prompt: "Second", isolated: false, apply: true, merge: "patch" }],
    })
    const resolved = resolveSpawnItems(prepared)
    expect(resolved.kind).toBe("ok")
    if (resolved.kind !== "ok") throw new Error(resolved.error.message)
    const [first, second] = resolved.items
    if (first === undefined || second === undefined) throw new Error("Missing batch items")
    expect(singleSpawnParams(first, true)).toMatchObject({ isolated: true, apply: false, merge: "branch" })
    expect(singleSpawnParams(second, true)).toMatchObject({ isolated: false, apply: true, merge: "patch" })
  })

  // apply/merge are inert without isolation, so a value that asks for nothing new is accepted and
  // ignored; only a behaviour-changing value is refused, and the refusal names field and value.
  test.each([{ apply: false }, { merge: "patch" as const }, { apply: false, merge: "patch" as const }])(
    "accepts no-op isolation fields without isolation (%o)",
    async (options) => {
      const result = await buildTaskExecute(makeDeps(startedManager()))("call", {
        prompt: "Inspect", category: "quick", isolated: false, run_in_background: true, ...options,
      }, undefined, undefined, CTX)
      expect(result.details.status).toBe("running")
    },
  )

  test.each([
    { options: { apply: true }, named: "apply: true" },
    { options: { merge: "branch" as const }, named: 'merge: "branch"' },
  ])("refuses behaviour-changing isolation fields without isolation", async ({ options, named }) => {
    const result = await buildTaskExecute(makeDeps(startedManager()))("call", {
      prompt: "Inspect", category: "quick", ...options,
    }, undefined, undefined, CTX)
    expect(result.details.status).toBe("invalid_arguments")
    expect(result.details.reason).toContain(named)
    expect(result.details.reason).toContain("isolated: true")
  })

  test("refuses a batch item inheriting apply: true from the top level, naming the item", async () => {
    const result = await buildTaskExecute(makeDeps(startedManager()))("call", {
      category: "quick", apply: true,
      tasks: [{ prompt: "First", isolated: true }, { prompt: "Second", name: "second" }],
    }, undefined, undefined, CTX)
    expect(result.details.status).toBe("invalid_arguments")
    expect(result.details.reason).toContain("Task item 1 (second)")
    expect(result.details.reason).toContain("apply: true")
  })

  test("accepts a batch whose items inherit only no-op isolation fields", async () => {
    const result = await buildTaskExecute(makeDeps(startedManager()))("call", {
      category: "quick", apply: false, merge: "patch", run_in_background: true,
      tasks: [{ prompt: "First" }, { prompt: "Second" }],
    }, undefined, undefined, CTX)
    expect(result.details.status).not.toBe("invalid_arguments")
  })

  test("explicit false overrides an enabled setting for batch validation", async () => {
    const deps = makeDeps(startedManager(), {
      omoConfig: { task: OmoTaskSettingsSchema.parse({ isolation: { enabled: true } }) },
    })
    const result = await buildTaskExecute(deps)("call", {
      category: "quick", isolated: true, merge: "branch",
      tasks: [{ prompt: "First" }, { prompt: "Second", isolated: false }],
    }, undefined, undefined, CTX)
    expect(result.details.status).toBe("invalid_arguments")
    expect(result.details.reason).toContain('merge: "branch"')
  })

  test("enabled settings reach the manager spec and call overrides win", () => {
    const deps = makeDeps(createFakeManager({}), {
      omoConfig: { task: OmoTaskSettingsSchema.parse({ isolation: { enabled: true, apply: false, merge: "branch" } }) },
    })
    expect(buildStartSpec({ prompt: "Inspect" }, { category: "quick" }, "parent", deps, "/project"))
      .toMatchObject({ isolated: true, apply: false, merge: "branch" })
    expect(buildStartSpec({ prompt: "Inspect", isolated: true, apply: true, merge: "patch" }, { category: "quick" }, "parent", deps, "/project"))
      .toMatchObject({ isolated: true, apply: true, merge: "patch" })
  })

  test("call row displays isolation beside foreground or background", () => {
    expect(taskCallLines({ isolated: true, run_in_background: true })[0]).toBe("task background isolated")
    expect(taskCallLines({ isolated: false })[0]).toBe("task foreground")
  })
})
