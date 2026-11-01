import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { createCommentCheckerHooks } from "./hook"
import { stopPendingCallCleanup } from "./pending-calls"
import { _resetCommentCheckerInitializationForTesting } from "./initialization-gate"

const startPendingCallCleanup = mock(() => {})
const initializeCommentCheckerCli = mock(() => {})

const cliRunner = {
  initializeCommentCheckerCli,
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli: async () => {},
  processApplyPatchEditsWithCli: async () => {},
}

describe("comment-checker lazy initialization", () => {
  beforeEach(() => {
    startPendingCallCleanup.mockClear()
    initializeCommentCheckerCli.mockClear()
    _resetCommentCheckerInitializationForTesting()
  })

  afterEach(() => {
    stopPendingCallCleanup()
    _resetCommentCheckerInitializationForTesting()
  })

  it("initializes CLI and cleanup on first tool hook call only", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, cliRunner, { startPendingCallCleanup })
    const beforeHook = hooks["tool.execute.before"]
    const input = { tool: "write", sessionID: "ses_test", callID: "call_test" }
    const output = { args: { filePath: "src/a.ts" } }

    // when
    expect(startPendingCallCleanup).toHaveBeenCalledTimes(0)
    expect(initializeCommentCheckerCli).toHaveBeenCalledTimes(0)

    // then
    await beforeHook(input, output)
    expect(startPendingCallCleanup).toHaveBeenCalledTimes(1)
    expect(initializeCommentCheckerCli).toHaveBeenCalledTimes(1)

    // when
    await beforeHook(input, output)

    // then
    expect(startPendingCallCleanup).toHaveBeenCalledTimes(1)
    expect(initializeCommentCheckerCli).toHaveBeenCalledTimes(1)
  })
})
