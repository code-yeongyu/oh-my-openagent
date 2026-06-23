/// <reference path="./bun-test.d.ts" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { _resetForTesting, setSessionAgent } from "../../features/claude-code-session-state/state"
import { isEpistemicInterlockCandidate } from "./epistemic-interlock-gate"
import { createEpistemicInterlockGateHook } from "./epistemic-interlock-hook"
import type { ReasoningCoreClient } from "./reasoning-core-client"

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    evaluate: mock(() => Promise.resolve({ allow: true })),
    solve: mock(() => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 1, total_count: 1 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(() => Promise.resolve({ domains: {}, solved: false, solved_count: 0, total_count: 1 })),
    kbQuery: mock(() => Promise.resolve({ count: 0, entries: [] })),
    kbAdd: mock(() => Promise.resolve({ id: "kb_test_123" })),
    kbRemove: mock(() => Promise.resolve()),
    check: mock(() => Promise.resolve({ signal: "Continue", iteration: 0, reason: "" })),
    status: mock(() => Promise.resolve({ session_active: true, domains: {}, is_solved: false, reasoning_history: [] })),
    disposeSession: mock(() => {}),
    disposeAll: mock(() => {}),
    dispose: mock(() => {}),
    ...overrides,
  }
}

describe("epistemic-interlock Prometheus exemption", () => {
  beforeEach(() => {
    _resetForTesting()
    mock.restore()
  })

  afterEach(() => {
    _resetForTesting()
    mock.restore()
  })

  describe("#given a normalized candidate action", () => {
    it("#when the agent key is prometheus #then the interlock is skipped", () => {
      expect(
        isEpistemicInterlockCandidate({
          tool: "write",
          sessionID: "session-prometheus-candidate",
          agent: "prometheus",
          args: { file_path: ".sisyphus/plans/test-plan.md" },
        }),
      ).toBe(false)
    })
  })

  describe("#given the hook sees a Prometheus display-name variant", () => {
    it("#when normalization does not return the prometheus key #then the hook still skips the interlock", async () => {
      setSessionAgent("session-prometheus-planner", "Prometheus (Planner)")

      const kbQuery = mock(() => Promise.resolve({
        count: 1,
        entries: [{ tags: ["constraint:planning"] }],
      }))
      const client = createMockClient({
        kbQuery,
        evaluate: mock(() => Promise.resolve({ allow: false, reason: "should not run" })),
      })

      const hook = createEpistemicInterlockGateHook({ client }, {
        getSessionAgent: () => "Prometheus (Planner)",
        getAgentConfigKey: () => "prometheus (planner)",
      })

      await hook["tool.execute.before"](
        { tool: "write", sessionID: "session-prometheus-planner", callID: "call-prometheus-planner" },
        { args: { file_path: ".sisyphus/plans/test-plan.md" } },
      )

      expect(kbQuery).not.toHaveBeenCalled()
    })
  })
})
