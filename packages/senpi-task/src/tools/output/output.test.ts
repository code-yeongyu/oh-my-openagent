import { describe, expect, test } from "bun:test"

import type { ListScope, ListedTask } from "../../manager"
import type { ResolvedModelRecord, TaskRecord } from "../../state"
import { makeRecord } from "./__fixtures__/records"
import { runTaskOutput } from "./output"
import type { OutputManager, TaskOutputDeps, TaskOutputToolResult, TranscriptReadResult } from "./types"

const WAIT_CONFIG = { min_ms: 5000, default_ms: 60000, max_ms: 600000 } as const

function managerFrom(records: readonly TaskRecord[]): OutputManager {
  return {
    get: (taskId) => records.find((record) => record.task_id === taskId),
    list(scope: ListScope): readonly ListedTask[] {
      const filtered =
        scope.scope === "all" ? records : records.filter((record) => record.parent_session_id === scope.session_id)
      return filtered.map((record) => ({ record }))
    },
    waitFor: () => Promise.reject(new Error("waitFor should not be called")),
  }
}

function depsFrom(records: readonly TaskRecord[], reader?: () => TranscriptReadResult): TaskOutputDeps {
  return {
    manager: managerFrom(records),
    stateDir: "/tmp/state",
    waitConfig: WAIT_CONFIG,
    now: () => Date.parse("2024-12-03T15:00:00.000Z"),
    transcriptReader: reader ?? (() => ({ entries: [], source: "none" })),
  }
}

function firstText(result: TaskOutputToolResult): string {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

describe("runTaskOutput", () => {
  test("#given a completed task in tail mode #when read #then the last assistant text is present", async () => {
    // given
    const record = makeRecord({ task_id: "st_done", status: "completed", final_response: "all done" })
    const deps = depsFrom([record], () => ({
      entries: [
        { kind: "assistant", text: "starting the work" },
        { kind: "tool", tool: "bash", is_error: false },
        { kind: "assistant", text: "finished the work" },
      ],
      source: "event-log",
    }))

    // when
    const result = await runTaskOutput(deps, { task_id: "st_done", mode: "tail" }, "session-parent")

    // then
    expect(result.details.kind).toBe("transcript")
    if (result.details.kind === "transcript") {
      expect(result.details.transcript).toContain("finished the work")
      expect(result.details.source).toBe("event-log")
    }
  })

  test("#given default mode #when read #then a status snapshot with final_response is returned", async () => {
    // given
    const record = makeRecord({ task_id: "st_done", status: "completed", final_response: "the answer" })
    const deps = depsFrom([record])

    // when
    const result = await runTaskOutput(deps, { task_id: "st_done" }, "session-parent")

    // then
    expect(result.details.kind).toBe("status")
    if (result.details.kind === "status") {
      expect(result.details.snapshot.final_response).toBe("the answer")
      expect(result.details.snapshot.status).toBe("completed")
    }
  })

  test("#given a task with a resolved model #when read #then status uses display plus reasoning details", async () => {
    // given
    const resolvedModel = {
      provider: "openai",
      model_id: "gpt-5.6-sol",
      display: "GPT-5.6 Sol",
      reasoning_effort: "high",
      variant: "xhigh",
      source: "category",
    } satisfies ResolvedModelRecord
    const record = {
      ...makeRecord({ task_id: "st_resolved", model: "openai/gpt-5.6-sol", status: "completed" }),
      resolved_model: resolvedModel,
    }
    const deps = depsFrom([record])

    // when
    const result = await runTaskOutput(deps, { task_id: "st_resolved" }, "session-parent")

    // then
    const text = firstText(result)
    expect(text).toContain("model GPT-5.6 Sol (reasoning high, variant xhigh)")
    expect(text).not.toContain("model openai/gpt-5.6-sol")
    expect(result.details.kind).toBe("status")
    if (result.details.kind === "status") {
      expect(result.details.snapshot.resolved_model).toEqual(resolvedModel)
    }
  })

  test("#given a task without a resolved model #when read #then status keeps raw model fallback", async () => {
    // given
    const record = makeRecord({ task_id: "st_raw", model: "anthropic/claude-sonnet-4-5", status: "completed" })
    const deps = depsFrom([record])

    // when
    const result = await runTaskOutput(deps, { task_id: "st_raw" }, "session-parent")

    // then
    const text = firstText(result)
    expect(text).toContain("model anthropic/claude-sonnet-4-5")
    expect(text).not.toContain("reasoning")
    expect(text).not.toContain("variant")
  })

  test("#given a lost task #when read #then a status view with a lost explanation and pid/session-dir breadcrumbs is returned without throwing", async () => {
    // given
    const record = makeRecord({ task_id: "st_lost", status: "lost", pid: 4242 })
    const deps = depsFrom([record])

    // when
    const result = await runTaskOutput(deps, { task_id: "st_lost", mode: "tail" }, "session-parent")

    // then
    expect(result.details.kind).toBe("status")
    if (result.details.kind === "status") {
      expect(result.details.snapshot.lost).toBeDefined()
      expect(result.details.snapshot.lost?.pid).toBe(4242)
      expect(result.details.snapshot.lost?.session_dir).toContain("st_lost")
      expect(result.details.snapshot.lost?.explanation.length).toBeGreaterThan(0)
    }
  })

  test("#given a task owned by another session #when read #then it is not found (fail-closed scope)", async () => {
    // given
    const record = makeRecord({ task_id: "st_other", parent_session_id: "session-other" })
    const deps = depsFrom([record])

    // when
    const result = await runTaskOutput(deps, { task_id: "st_other", mode: "status" }, "session-parent")

    // then
    expect(result.details.kind).toBe("not_found")
  })

  test("#given no caller session #when read #then it fails closed as not found", async () => {
    // given
    const record = makeRecord({ task_id: "st_a", parent_session_id: "session-parent" })
    const deps = depsFrom([record])

    // when
    const result = await runTaskOutput(deps, { task_id: "st_a", mode: "status" }, undefined)

    // then
    expect(result.details.kind).toBe("not_found")
  })

  test("#given neither task_id nor name #when read #then invalid arguments are reported", async () => {
    // given
    const deps = depsFrom([])

    // when
    const result = await runTaskOutput(deps, { mode: "status" }, "session-parent")

    // then
    expect(result.details.kind).toBe("invalid_arguments")
  })

  test("#given a name instead of an id #when read #then the task is resolved by name", async () => {
    // given
    const record = makeRecord({ task_id: "st_named", name: "explorer", status: "completed", final_response: "found" })
    const deps = depsFrom([record])

    // when
    const result = await runTaskOutput(deps, { name: "explorer", mode: "status" }, "session-parent")

    // then
    expect(result.details.kind).toBe("status")
    if (result.details.kind === "status") {
      expect(result.details.snapshot.task_id).toBe("st_named")
    }
  })
})
