import { describe, expect, it } from "bun:test"

import { stripAnsi } from "../doctor/format-shared"
import { formatJsonOutput, formatTextOutput } from "./formatter"
import type { BoulderCliResult } from "./types"

describe("boulder formatter", () => {
  it("renders text output with statuses and progress", () => {
    const result: BoulderCliResult = {
      works: [
        {
          work_id: "w1",
          plan_name: "alpha",
          active_plan: "/tmp/alpha.md",
          status: "active",
          started_at: "2026-05-10T00:00:00.000Z",
          elapsed_human: "30m 0s",
          total_tasks: 2,
          completed_tasks: 1,
          remaining_tasks: 1,
          percentage: 50,
          session_count: 2,
          current_task: {
            task_key: "todo:2",
            task_title: "Alpha task",
            elapsed_human: "1m 0s",
          },
        },
      ],
    }

    const textOutput = stripAnsi(formatTextOutput(result))
    expect(textOutput).toContain("boulder progress")
    expect(textOutput).toContain("plan: alpha")
    expect(textOutput).toContain("status: active")
    expect(textOutput).toContain("progress: 50% (1/2)")
    expect(textOutput).toContain("elapsed: 30m 0s")
  })

  it("renders parseable json output", () => {
    const result: BoulderCliResult = {
      works: [
        {
          work_id: "w1",
          plan_name: "alpha",
          active_plan: "/tmp/alpha.md",
          status: "completed",
          started_at: "2026-05-10T00:00:00.000Z",
          ended_at: "2026-05-10T00:01:00.000Z",
          elapsed_ms: 60_000,
          total_tasks: 2,
          completed_tasks: 2,
          remaining_tasks: 0,
          percentage: 100,
          session_count: 1,
        },
      ],
    }

    const jsonOutput = formatJsonOutput(result)
    expect(JSON.parse(jsonOutput)).toEqual(result)
  })
})
