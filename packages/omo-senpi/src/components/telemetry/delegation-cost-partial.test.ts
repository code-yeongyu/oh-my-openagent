import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "@oh-my-opencode/senpi-task"

import { projectDelegationCompleted } from "./delegation-projection"

describe("delegation telemetry for a partial cost (#10724)", () => {
  test("#given a run whose cost is a lower bound #when projected #then it ships as partial with its figure", () => {
    // given
    const record = {
      ...createTaskRecord({ parent_session_id: "p", root_session_id: "p", depth: 1, execution_mode: "in-process", model: "zai/glm-5.3", notify_on_terminal: false }),
      status: "completed" as const,
      run_stats: { runtime_ms: 10, turns: 2, tool_calls: 0, cost_usd: 0.25, cost_status: "partial" as const, token_status: "partial" as const },
    }

    // when
    const props = projectDelegationCompleted({ edge: { record }, sessionHash: "h", steerCounts: { running: 0, queued: 0 }, startReason: "initial_spawn" })

    // then
    expect(props.cost_status).toBe("partial")
    expect(props.cost_usd).toBe(0.25)
  })
})
