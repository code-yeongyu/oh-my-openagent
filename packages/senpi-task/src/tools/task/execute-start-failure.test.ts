import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import { recordSummary } from "./result-details"

describe("buildTaskExecute start failures", () => {
  test("#given a typed host-session open timeout #when task executes #then text and details expose only the parent-authored class", async () => {
    // given
    const message = "The task host did not finish opening the child session in time (open_timed_out)."
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "start_failed",
        task_id: "st_open_timeout",
        name: "timed-child",
        category: "quick",
        execution_mode: "process",
        model: "test/model",
        run_in_background: false,
        error_message: message,
        failure_kind: "session_unavailable",
        failure_reason: "open_timed_out",
      }),
    })

    // when
    const result = await buildTaskExecute(makeDeps(manager))(
      "call-open-timeout",
      { prompt: "work", category: "quick" },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(result.content).toEqual([{ type: "text", text: message }])
    expect(result.details).toMatchObject({
      task_id: "st_open_timeout",
      status: "error",
      failure_kind: "session_unavailable",
      failure_reason: "open_timed_out",
      reason: message,
    })
  })

  test("#given a background batch start failure #when task executes #then each item keeps the closed class", async () => {
    // given
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        startIndex += 1
        return {
          kind: "start_failed",
          task_id: `st_batch_timeout_${startIndex}`,
          name: `batch-child-${startIndex}`,
          category: "quick",
          execution_mode: "process",
          model: "test/model",
          run_in_background: true,
          error_message: "The task host did not finish opening the child session in time (open_timed_out).",
          failure_kind: "session_unavailable",
          failure_reason: "open_timed_out",
        }
      },
    })

    // when
    const result = await buildTaskExecute(makeDeps(manager))(
      "call-batch-timeout",
      {
        category: "quick",
        run_in_background: true,
        tasks: [{ prompt: "work one" }, { prompt: "work two" }],
      },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(result.details.items).toHaveLength(2)
    for (const item of result.details.items ?? []) {
      expect(item).toMatchObject({
        failure_kind: "session_unavailable",
        failure_reason: "open_timed_out",
      })
    }
  })

  test("#given a persisted start failure #when task output details summarize it #then the closed class is present", () => {
    // given
    const record = makeRecord({
      status: "error",
      error_message: "The task host did not finish opening the child session in time (open_timed_out).",
      failure_kind: "session_unavailable",
      failure_reason: "open_timed_out",
    })

    // when
    const summary = recordSummary(record)

    // then
    expect(summary).toMatchObject({
      failure_kind: "session_unavailable",
      failure_reason: "open_timed_out",
    })
  })
})
