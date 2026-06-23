/// <reference path="./bun-test.d.ts" />

import { describe, expect, it, mock } from "bun:test"
import { createEpistemicInterlockGateHook } from "./epistemic-interlock-hook"
import type { ReasoningCoreClient } from "./reasoning-core-client"

function createMockClient(overrides?: Partial<ReasoningCoreClient>): ReasoningCoreClient {
  return {
    evaluate: mock(() => Promise.resolve({ allow: true })),
    solve: mock(() => Promise.resolve({
      stop_signal: "Solved",
      argumentation_result: { conclusions: { "allow_action(current)": { status: "Accepted" } } },
      constraint_state: { domains: {}, solved: true, solved_count: 4, total_count: 4 },
      iterations_used: 1,
      reasoning_trace: [],
    })),
    constrain: mock(() => Promise.resolve({ domains: {}, solved: false, solved_count: 0, total_count: 4 })),
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

describe("epistemic-interlock-hook", () => {
  describe("#given write by non-prometheus with KB constraint", () => {
    it("#when KB has constraint entries and evaluate denies #then throws", async () => {
      const entries = [{ tags: ["constraint:architecture"], content: { Insight: { lesson: "No direct mutations" } } }]
      const client = createMockClient({
        kbQuery: mock(() => Promise.resolve({ count: 1, entries })),
        evaluate: mock(() => Promise.resolve({ allow: false, reason: "constraint violated" })),
      })
      const hook = createEpistemicInterlockGateHook({ client })
      const input = { tool: "write", sessionID: "ses-test", callID: "call-1" }
      const output = { args: { file_path: "src/foo.ts" } }

      let thrown = false
      try {
        await hook["tool.execute.before"](input, output)
      } catch (err) {
        thrown = true
        expect((err as Error).message).toEqual(
          "Epistemic Interlock: Write blocked. KB constraint defeats mutation on src/foo.ts: constraint violated. To proceed: call reason_argue with an ASPIC+ theory that produces an authorization conclusion such as mutation_authorized_on_unknown_path or allow_action(current). The proof will be automatically persisted to the Learned KB, then retry the Write. If the counter-theory is rejected, the block is legitimate.",
        )
      }
      expect(thrown).toBe(true)
    })
  })

  describe("#given write by prometheus", () => {
    it("#when prometheus writes #then passes without evaluation", async () => {
      const kbQuery = mock(() => Promise.resolve({ count: 1, entries: [{ tags: ["constraint:x"] }] }))
      const client = createMockClient({ kbQuery })
      const input = { tool: "write", sessionID: "ses-test", callID: "call-2" }
      const output = { args: { file_path: "src/bar.ts" } }

      const freshHook = createEpistemicInterlockGateHook({ client }, {
        getSessionAgent: () => "Prometheus",
        getAgentConfigKey: () => "prometheus",
      })

      await freshHook["tool.execute.before"](input, output)
      expect(kbQuery).not.toHaveBeenCalled()
    })
  })
})
