import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { toolResult } from "../control"
import { renderTaskOutputResult, type OutputRenderTheme } from "./renderers"
import type { TaskOutputDetails } from "./types"

const TEST_THEME: OutputRenderTheme = {
  fg: (_color: ThemeColor, text: string) => text,
}

const RESULT_OPTIONS = { expanded: false, isPartial: false }

describe("task_output run stats rendering", () => {
  test("#given a completed task with run stats #when the status row renders #then duration tool count and tps stay adjacent", () => {
    // given
    const details: TaskOutputDetails = {
      kind: "status",
      snapshot: {
        task_id: "st_done",
        status: "completed",
        residency_state: "resident",
        execution_mode: "in-process",
        model: "raw-model",
        parent_session_id: "session-parent",
        root_session_id: "session-root",
        age_ms: 10,
        run_stats: {
          runtime_ms: 134_000,
          turns: 3,
          tool_calls: 5,
          output_tokens: 900,
          total_tokens: 4_200,
          generation_ms: 7_600,
          tokens_per_second: 118,
        },
      },
    }

    // when
    const [line = ""] = renderTaskOutputResult(toolResult("ignored", details), RESULT_OPTIONS, TEST_THEME).render(200)

    // then
    expect(line).toContain("task_output st_done completed")
    expect(line).toContain("· ran 2m 14s · 5 tools · 118 tok/s")
  })
})
