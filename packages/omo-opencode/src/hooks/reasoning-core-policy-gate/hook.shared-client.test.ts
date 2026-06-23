import { describe, expect, it, mock } from "bun:test"

import type { ReasoningCoreClient } from "./reasoning-core-client"
import { createReasoningCorePolicyGateHook } from "./hook"

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

describe("createReasoningCorePolicyGateHook shared client wiring", () => {
  it("uses the injected reasoning-core client instead of creating a separate one", async () => {
    const evaluate = mock(() => Promise.resolve({ allow: true }))
    const client = createMockClient({ evaluate })
    const hook = createReasoningCorePolicyGateHook({
      client,
      binaryPath: "/nonexistent",
      timeoutMs: 1,
    } as never)

    await expect(
      hook["tool.execute.before"](
        { tool: "read", sessionID: "session-shared-client", callID: "call-shared-client" },
        { args: { filePath: "/tmp/demo.ts" } },
      ),
    ).resolves.toBeUndefined()

    expect(evaluate).toHaveBeenCalledTimes(1)
  })
})
