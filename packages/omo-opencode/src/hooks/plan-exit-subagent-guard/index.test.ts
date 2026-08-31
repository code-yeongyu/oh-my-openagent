/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { subagentSessions } from "../../features/claude-code-session-state/state"
import { createPlanExitSubagentGuardHook, HOOK_NAME } from "./index"

describe("plan-exit-subagent-guard", () => {
  test("#given delegated subagent session #then plan_exit is denied with parent-return guidance", async () => {
    // given
    const hook = createPlanExitSubagentGuardHook()
    const sessionID = "guard-test-subagent-plan-exit"
    subagentSessions.add(sessionID)

    // when
    let thrown: unknown
    try {
      await hook["tool.execute.before"]({ tool: "plan_exit", sessionID, callID: "call-1" }, { args: {} })
    } catch (error) {
      thrown = error
    } finally {
      subagentSessions.delete(sessionID)
    }

    // then
    expect(thrown).toBeInstanceOf(Error)
    const message = (thrown as Error).message
    expect(message).toContain(HOOK_NAME)
    expect(message).toContain("plan_exit")
    expect(message).toContain("final message")
  })

  test("#given delegated subagent session #then plan_enter is denied", async () => {
    // given
    const hook = createPlanExitSubagentGuardHook()
    const sessionID = "guard-test-subagent-plan-enter"
    subagentSessions.add(sessionID)

    // when
    let thrown: unknown
    try {
      await hook["tool.execute.before"]({ tool: "plan_enter", sessionID, callID: "call-2" }, { args: {} })
    } catch (error) {
      thrown = error
    } finally {
      subagentSessions.delete(sessionID)
    }

    // then
    expect(thrown).toBeInstanceOf(Error)
  })

  test("#given primary session #then plan_exit passes through untouched", async () => {
    // given
    const hook = createPlanExitSubagentGuardHook()
    const sessionID = "guard-test-primary"
    subagentSessions.delete(sessionID)

    // when
    await hook["tool.execute.before"]({ tool: "plan_exit", sessionID, callID: "call-3" }, { args: {} })

    // then - no throw
  })

  test("#given delegated subagent session #then unrelated tools pass through untouched", async () => {
    // given
    const hook = createPlanExitSubagentGuardHook()
    const sessionID = "guard-test-subagent-unrelated"
    subagentSessions.add(sessionID)

    // when
    await hook["tool.execute.before"]({ tool: "read", sessionID, callID: "call-4" }, { args: {} })

    // then - no throw
    subagentSessions.delete(sessionID)
  })
})
