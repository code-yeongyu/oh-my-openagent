/// <reference types="bun-types" />

import { describe, expect, it, mock } from "bun:test"
import {
  createCommentCheckerHooks,
  type CommentCheckerHookDependencies,
} from "./hook"
import {
  ensureCommentCheckerInitialization,
  _resetCommentCheckerInitializationForTesting,
} from "./initialization-gate"

const startPendingCallCleanup = mock(() => {})
const initializeCommentCheckerCli = mock(() => {})

function createDependencies(): CommentCheckerHookDependencies {
  return {
    initializeCommentCheckerCli,
    getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
    isCliPathUsable: (cliPath): cliPath is string => typeof cliPath === "string",
    processWithCli: async () => {},
    processApplyPatchEditsWithCli: async () => {},
    registerPendingCall: () => {},
    startPendingCallCleanup,
    stopPendingCallCleanup: () => {},
    takePendingCall: () => undefined,
    ensureCommentCheckerInitialization,
  }
}

describe("comment-checker lazy initialization", () => {
  it("initializes CLI and cleanup on first tool hook call only", async () => {
    // given
    _resetCommentCheckerInitializationForTesting()
    const hooks = createCommentCheckerHooks(undefined, createDependencies())
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
