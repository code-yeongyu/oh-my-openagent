import { describe, expect, it, mock, afterAll } from "bun:test"

const startPendingCallCleanup = mock(() => {})
const initializeCommentCheckerCli = mock(() => {})

mock.module("./cli-runner", () => ({
  initializeCommentCheckerCli,
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli: async () => {},
  processApplyPatchEditsWithCli: async () => {},
}))

mock.module("./pending-calls", () => ({
  registerPendingCall: () => {},
  startPendingCallCleanup,
  stopPendingCallCleanup: () => {},
  takePendingCall: () => undefined,
}))

afterAll(() => {
  mock.restore()
})

const { createCommentCheckerHooks } = await import("./hook")

describe("comment-checker lazy initialization", () => {
  it("initializes CLI and cleanup on first tool hook call only", async () => {
    // given
    const hooks = createCommentCheckerHooks()
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
