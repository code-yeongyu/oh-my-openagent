/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import {
  createCommentCheckerHooks,
  type CommentCheckerHookDependencies,
} from "./hook"
import {
  registerPendingCall,
  startPendingCallCleanup,
  stopPendingCallCleanup,
  takePendingCall,
} from "./pending-calls"
import {
  ensureCommentCheckerInitialization,
  _resetCommentCheckerInitializationForTesting,
} from "./initialization-gate"

const processWithCli = mock<CommentCheckerHookDependencies["processWithCli"]>(async () => {})

function createDependencies(): CommentCheckerHookDependencies {
  return {
    initializeCommentCheckerCli: () => {},
    getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
    isCliPathUsable: (cliPath): cliPath is string => typeof cliPath === "string",
    processWithCli,
    processApplyPatchEditsWithCli: async () => {},
    registerPendingCall,
    startPendingCallCleanup,
    stopPendingCallCleanup,
    takePendingCall,
    ensureCommentCheckerInitialization,
  }
}

describe("comment-checker mutation tool routing", () => {
  beforeEach(() => {
    processWithCli.mockClear()
    stopPendingCallCleanup()
    _resetCommentCheckerInitializationForTesting()
  })

  afterEach(() => {
    stopPendingCallCleanup()
    _resetCommentCheckerInitializationForTesting()
  })

  it("#given write tool with filePath #when before and after hooks run #then it checks the pending write", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, createDependencies())
    const input = { tool: "write", sessionID: "ses_test", callID: "call_write" }

    // when
    await hooks["tool.execute.before"](input, {
      args: { filePath: "/repo/src/write.ts", content: "// write comment\nconst a = 1\n" },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(1)
    const call = processWithCli.mock.calls[0]
    if (!call) throw new Error("missing processWithCli call")
    expect(call[0]).toBe(input)
    expect(call[1]).toMatchObject({
      filePath: "/repo/src/write.ts",
      content: "// write comment\nconst a = 1\n",
      tool: "write",
      sessionID: "ses_test",
    })
    expect(call[2]).toEqual({ title: "ok", output: "Success", metadata: {} })
    expect(call[3]).toBe("/tmp/fake-comment-checker")
    expect(call[4]).toBeUndefined()
    expect(typeof call[5]).toBe("function")
  })

  it("#given edit tool with file_path #when before and after hooks run #then it checks the pending edit", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, createDependencies())
    const input = { tool: "edit", sessionID: "ses_test", callID: "call_edit" }

    // when
    await hooks["tool.execute.before"](input, {
      args: {
        file_path: "/repo/src/edit.ts",
        old_string: "const b = 1\n",
        new_string: "// edit comment\nconst b = 1\n",
      },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(1)
    const call = processWithCli.mock.calls[0]
    if (!call) throw new Error("missing processWithCli call")
    expect(call[0]).toBe(input)
    expect(call[1]).toMatchObject({
      filePath: "/repo/src/edit.ts",
      oldString: "const b = 1\n",
      newString: "// edit comment\nconst b = 1\n",
      tool: "edit",
    })
    expect(call[2]).toEqual({ title: "ok", output: "Success", metadata: {} })
    expect(call[3]).toBe("/tmp/fake-comment-checker")
    expect(call[4]).toBeUndefined()
    expect(typeof call[5]).toBe("function")
  })

  it("#given multiedit tool with path #when before and after hooks run #then it checks the pending multiedit", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, createDependencies())
    const input = { tool: "multiedit", sessionID: "ses_test", callID: "call_multiedit" }
    const edits = [{ old_string: "const c = 1\n", new_string: "// multiedit comment\nconst c = 1\n" }]

    // when
    await hooks["tool.execute.before"](input, {
      args: { path: "/repo/src/multiedit.ts", edits },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(1)
    const call = processWithCli.mock.calls[0]
    if (!call) throw new Error("missing processWithCli call")
    expect(call[0]).toBe(input)
    expect(call[1]).toMatchObject({
      filePath: "/repo/src/multiedit.ts",
      edits,
      tool: "multiedit",
    })
    expect(call[2]).toEqual({ title: "ok", output: "Success", metadata: {} })
    expect(call[3]).toBe("/tmp/fake-comment-checker")
    expect(call[4]).toBeUndefined()
    expect(typeof call[5]).toBe("function")
  })

  it("#given non-mutation tool #when before and after hooks run #then it does not run the checker", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, createDependencies())
    const input = { tool: "read", sessionID: "ses_test", callID: "call_read" }

    // when
    await hooks["tool.execute.before"](input, { args: { filePath: "/repo/src/read.ts" } })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(0)
  })
})
