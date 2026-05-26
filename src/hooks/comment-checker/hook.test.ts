import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const processWithCliMock = mock(async () => {})
const processApplyPatchEditsWithCliMock = mock(async () => {})
const extractApplyPatchEditsMock = mock(() => [] as Array<{ filePath: string }>)

mock.module("./cli-runner", () => ({
  initializeCommentCheckerCli: () => {},
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli: processWithCliMock,
  processApplyPatchEditsWithCli: processApplyPatchEditsWithCliMock,
}))

mock.module("@oh-my-opencode/comment-checker-core", () => ({
  extractApplyPatchEdits: extractApplyPatchEditsMock,
}))

afterAll(() => {
  mock.restore()
})

const { createCommentCheckerHooks } = await import("./hook")
const { stopPendingCallCleanup } = await import("./pending-calls")
const { _resetCommentCheckerInitializationForTesting } = await import("./initialization-gate")

describe("comment-checker hook", () => {
  beforeEach(() => {
    processWithCliMock.mockClear()
    processApplyPatchEditsWithCliMock.mockClear()
    extractApplyPatchEditsMock.mockClear()
    stopPendingCallCleanup()
    _resetCommentCheckerInitializationForTesting()
  })

  afterEach(() => {
    stopPendingCallCleanup()
    _resetCommentCheckerInitializationForTesting()
  })

  describe("#given tool.execute.before", () => {
    it("#when tool is write #then registers pending call with filePath and content", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: "/src/file.ts", content: "const x = 1\n" } }

      // when
      await hooks["tool.execute.before"](input, output)

      // then - verify by running after hook which should pick up the pending call
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })
      expect(processWithCliMock).toHaveBeenCalledTimes(1)
    })

    it("#when tool is edit with file_path #then registers pending call", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "edit", sessionID: "ses_2", callID: "call_2" }
      const output = {
        args: {
          file_path: "/src/edit.ts",
          old_string: "const a = 1\n",
          new_string: "// comment\nconst a = 1\n",
        },
      }

      // when
      await hooks["tool.execute.before"](input, output)
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCliMock).toHaveBeenCalledTimes(1)
      expect(processWithCliMock).toHaveBeenCalledWith(
        input,
        expect.objectContaining({
          filePath: "/src/edit.ts",
          oldString: "const a = 1\n",
          newString: "// comment\nconst a = 1\n",
          tool: "edit",
        }),
        expect.any(Object),
        "/tmp/fake-comment-checker",
        undefined,
        expect.any(Function),
      )
    })

    it("#when tool is read #then does not register pending call", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "read", sessionID: "ses_3", callID: "call_3" }

      // when
      await hooks["tool.execute.before"](input, { args: { filePath: "/src/file.ts" } })
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCliMock).toHaveBeenCalledTimes(0)
    })

    it("#when no filePath in args #then does not register pending call", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "write", sessionID: "ses_4", callID: "call_4" }

      // when
      await hooks["tool.execute.before"](input, { args: {} })
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCliMock).toHaveBeenCalledTimes(0)
    })

    it("#when tool is multiedit with path #then registers pending call with edits", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "multiedit", sessionID: "ses_5", callID: "call_5" }
      const edits = [{ old_string: "const b = 1\n", new_string: "// added\nconst b = 1\n" }]

      // when
      await hooks["tool.execute.before"](input, { args: { path: "/src/multi.ts", edits } })
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCliMock).toHaveBeenCalledTimes(1)
      expect(processWithCliMock).toHaveBeenCalledWith(
        input,
        expect.objectContaining({
          filePath: "/src/multi.ts",
          edits,
          tool: "multiedit",
        }),
        expect.any(Object),
        "/tmp/fake-comment-checker",
        undefined,
        expect.any(Function),
      )
    })
  })

  describe("#given tool.execute.after", () => {
    it("#when output indicates tool failure #then skips comment checking", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "write", sessionID: "ses_6", callID: "call_6" }
      await hooks["tool.execute.before"](input, {
        args: { filePath: "/src/file.ts", content: "// slop\nconst x = 1\n" },
      })

      // when - output contains error indicator
      await hooks["tool.execute.after"](input, {
        title: "error",
        output: "Error: file not found",
        metadata: {},
      })

      // then
      expect(processWithCliMock).toHaveBeenCalledTimes(0)
    })

    it("#when output contains 'failed to' #then skips comment checking", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "write", sessionID: "ses_7", callID: "call_7" }
      await hooks["tool.execute.before"](input, {
        args: { filePath: "/src/file.ts", content: "const x = 1\n" },
      })

      // when
      await hooks["tool.execute.after"](input, {
        title: "fail",
        output: "Failed to write file",
        metadata: {},
      })

      // then
      expect(processWithCliMock).toHaveBeenCalledTimes(0)
    })

    it("#when tool is apply_patch with edits #then processes with apply_patch handler", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "apply_patch", sessionID: "ses_8", callID: "call_8", args: {} }
      const metadata = { files: [{ filePath: "/src/patch.ts" }] }
      extractApplyPatchEditsMock.mockReturnValueOnce([{ filePath: "/src/patch.ts", newString: "// patched" }])

      // when
      await hooks["tool.execute.after"](input, { title: "ok", output: "Applied", metadata })

      // then
      expect(extractApplyPatchEditsMock).toHaveBeenCalledTimes(1)
      expect(processApplyPatchEditsWithCliMock).toHaveBeenCalledTimes(1)
    })

    it("#when tool is apply_patch with no edits #then skips processing", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "apply_patch", sessionID: "ses_9", callID: "call_9", args: {} }
      extractApplyPatchEditsMock.mockReturnValueOnce([])

      // when
      await hooks["tool.execute.after"](input, { title: "ok", output: "Applied", metadata: {} })

      // then
      expect(processApplyPatchEditsWithCliMock).toHaveBeenCalledTimes(0)
    })

    it("#when no pending call found for callID #then does nothing", async () => {
      // given
      const hooks = createCommentCheckerHooks()
      const input = { tool: "write", sessionID: "ses_10", callID: "call_unknown" }

      // when - no before hook was called, so no pending call exists
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCliMock).toHaveBeenCalledTimes(0)
    })

    it("#when custom_prompt config is provided #then passes it to processWithCli", async () => {
      // given
      const hooks = createCommentCheckerHooks({ custom_prompt: "No AI comments allowed" })
      const input = { tool: "write", sessionID: "ses_11", callID: "call_11" }
      await hooks["tool.execute.before"](input, {
        args: { filePath: "/src/file.ts", content: "// AI slop\nconst x = 1\n" },
      })

      // when
      await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

      // then
      expect(processWithCliMock).toHaveBeenCalledWith(
        input,
        expect.any(Object),
        expect.any(Object),
        "/tmp/fake-comment-checker",
        "No AI comments allowed",
        expect.any(Function),
      )
    })
  })

  describe("#given dispose", () => {
    it("#when called #then stops pending call cleanup", () => {
      // given
      const hooks = createCommentCheckerHooks()

      // when - should not throw
      hooks.dispose()

      // then - no error means cleanup was stopped successfully
      expect(true).toBe(true)
    })
  })
})

export {}
