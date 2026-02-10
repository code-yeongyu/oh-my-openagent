import { describe, it, expect, mock, beforeEach } from "bun:test"

const processApplyPatchEditsWithCli = mock(async () => {})

mock.module("./cli-runner", () => ({
  initializeCommentCheckerCli: () => {},
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli: async () => {},
  processApplyPatchEditsWithCli,
}))

const { createCommentCheckerHooks } = await import("./hook")

describe("comment-checker apply_patch integration", () => {
  beforeEach(() => {
    processApplyPatchEditsWithCli.mockClear()
  })

  it("runs comment checker using apply_patch metadata.files", async () => {
    // given
    const hooks = createCommentCheckerHooks()

    const input = { tool: "apply_patch", sessionID: "ses_test", callID: "call_test" }
    const output = {
      title: "ok",
      output: "Success. Updated the following files:\nM src/a.ts",
      metadata: {
        files: [
          {
            filePath: "/repo/src/a.ts",
            before: "const a = 1\n",
            after: "// comment\nconst a = 1\n",
            type: "update",
          },
          {
            filePath: "/repo/src/old.ts",
            movePath: "/repo/src/new.ts",
            before: "const b = 1\n",
            after: "// moved comment\nconst b = 1\n",
            type: "move",
          },
          {
            filePath: "/repo/src/delete.ts",
            before: "// deleted\n",
            after: "",
            type: "delete",
          },
        ],
      },
    }

    // when
    await hooks["tool.execute.after"](input, output)

    // then
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledTimes(1)
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledWith(
      "ses_test",
      [
        { filePath: "/repo/src/a.ts", before: "const a = 1\n", after: "// comment\nconst a = 1\n" },
        { filePath: "/repo/src/new.ts", before: "const b = 1\n", after: "// moved comment\nconst b = 1\n" },
      ],
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })

  it("skips when apply_patch metadata.files is missing", async () => {
    // given
    const hooks = createCommentCheckerHooks()
    const input = { tool: "apply_patch", sessionID: "ses_test", callID: "call_test" }
    const output = { title: "ok", output: "ok", metadata: {} }

    // when
    await hooks["tool.execute.after"](input, output)

    // then
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledTimes(0)
  })
})
