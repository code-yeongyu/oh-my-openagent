import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const hookModulePath = "./hook?before-after"
const hookModule: typeof import("./hook") = await import(hookModulePath)
const { createCommentCheckerHooks } = hookModule

const processWithCli = mock(async () => {})
const cliRunner = {
  initializeCommentCheckerCli: () => {},
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli,
  processApplyPatchEditsWithCli: async () => {},
}
const { stopPendingCallCleanup } = await import("./pending-calls")
const { _resetCommentCheckerInitializationForTesting } = await import("./initialization-gate")

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
    const hooks = createCommentCheckerHooks(undefined, cliRunner)
    const input = { tool: "write", sessionID: "ses_test", callID: "call_write" }

    // when
    await hooks["tool.execute.before"](input, {
      args: { filePath: "/repo/src/write.ts", content: "// write comment\nconst a = 1\n" },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(1)
    expect(processWithCli).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        filePath: "/repo/src/write.ts",
        content: "// write comment\nconst a = 1\n",
        tool: "write",
        sessionID: "ses_test",
      }),
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })

  it("#given write tool over an existing file #when before and after hooks run #then it records the file text being replaced", async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), "comment-checker-write-"))
    const filePath = join(dir, "existing.ts")
    const previousContent = "// SPDX-License-Identifier: MIT\nconst a = 1\n"
    writeFileSync(filePath, previousContent)
    const hooks = createCommentCheckerHooks(undefined, cliRunner)
    const input = { tool: "write", sessionID: "ses_test", callID: "call_write_existing" }

    try {
      // when
      await hooks["tool.execute.before"](input, {
        args: { filePath, content: "// SPDX-License-Identifier: MIT\nconst a = 2\n" },
      })
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCli).toHaveBeenCalledTimes(1)
      expect(processWithCli).toHaveBeenCalledWith(
        input,
        expect.objectContaining({ filePath, previousContent, tool: "write" }),
        expect.any(Object),
        "/tmp/fake-comment-checker",
        undefined,
        expect.any(Function),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given write tool for a new file #when before and after hooks run #then no previous text is recorded", async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), "comment-checker-write-"))
    const filePath = join(dir, "new.ts")
    const hooks = createCommentCheckerHooks(undefined, cliRunner)
    const input = { tool: "write", sessionID: "ses_test", callID: "call_write_new" }

    try {
      // when
      await hooks["tool.execute.before"](input, {
        args: { filePath, content: "// write comment\nconst a = 1\n" },
      })
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCli).toHaveBeenCalledTimes(1)
      const pendingCall = (processWithCli.mock.calls[0] as unknown[] | undefined)?.[1] as Record<string, unknown> | undefined
      expect(pendingCall?.previousContent).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given edit tool with file_path #when before and after hooks run #then it checks the pending edit", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, cliRunner)
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
    expect(processWithCli).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        filePath: "/repo/src/edit.ts",
        oldString: "const b = 1\n",
        newString: "// edit comment\nconst b = 1\n",
        tool: "edit",
      }),
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })

  it("#given multiedit tool with path #when before and after hooks run #then it checks the pending multiedit", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, cliRunner)
    const input = { tool: "multiedit", sessionID: "ses_test", callID: "call_multiedit" }
    const edits = [{ old_string: "const c = 1\n", new_string: "// multiedit comment\nconst c = 1\n" }]

    // when
    await hooks["tool.execute.before"](input, {
      args: { path: "/repo/src/multiedit.ts", edits },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(1)
    expect(processWithCli).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        filePath: "/repo/src/multiedit.ts",
        edits,
        tool: "multiedit",
      }),
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })

  it("#given edit tool with a camelCase edits array #when before and after hooks run #then it checks snake_case hunks", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, cliRunner)
    const input = { tool: "edit", sessionID: "ses_test", callID: "call_edit_edits" }
    const oldString = "const value = 1\n"
    const newString = "# Changed to double the value as requested\nconst value = 2\n"

    // when
    await hooks["tool.execute.before"](input, {
      args: {
        filePath: "/repo/src/aft-edit.ts",
        edits: [{ oldString, newString }],
      },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(1)
    expect(processWithCli).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        filePath: "/repo/src/aft-edit.ts",
        edits: [{ old_string: oldString, new_string: newString }],
        tool: "edit",
      }),
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })

  it("#given non-mutation tool #when before and after hooks run #then it does not run the checker", async () => {
    // given
    const hooks = createCommentCheckerHooks(undefined, cliRunner)
    const input = { tool: "read", sessionID: "ses_test", callID: "call_read" }

    // when
    await hooks["tool.execute.before"](input, { args: { filePath: "/repo/src/read.ts" } })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    // then
    expect(processWithCli).toHaveBeenCalledTimes(0)
  })
})
