import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test"

const processApplyPatchEditsWithCli = mock(async () => {})

mock.module("./cli-runner", () => ({
  initializeCommentCheckerCli: () => {},
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli: async () => {},
  processApplyPatchEditsWithCli,
}))

afterAll(() => { mock.restore() })

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

  it("#given apply_patch metadata nested under result #when hook runs #then checks edited files", async () => {
    // given
    const hooks = createCommentCheckerHooks()
    const input = { tool: "apply_patch", sessionID: "ses_test", callID: "call_test" }
    const output = {
      title: "ok",
      output: "Success",
      metadata: {
        result: {
          files: [
            {
              path: "/repo/src/result.ts",
              old: "const a = 1\n",
              new: "// result comment\nconst a = 1\n",
              operation: "update",
            },
          ],
        },
      },
    }

    // when
    await hooks["tool.execute.after"](input, output)

    // then
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledTimes(1)
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledWith(
      "ses_test",
      [
        {
          filePath: "/repo/src/result.ts",
          before: "const a = 1\n",
          after: "// result comment\nconst a = 1\n",
        },
      ],
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })

  it("#given apply_patch metadata nested under metadata #when hook runs #then checks edited files", async () => {
    // given
    const hooks = createCommentCheckerHooks()
    const input = { tool: "apply_patch", sessionID: "ses_test", callID: "call_test" }
    const output = {
      title: "ok",
      output: "Success",
      metadata: {
        metadata: {
          files: [
            {
              file_path: "/repo/src/metadata.ts",
              old_string: "const b = 1\n",
              new_string: "// metadata comment\nconst b = 1\n",
              type: "update",
            },
          ],
        },
      },
    }

    // when
    await hooks["tool.execute.after"](input, output)

    // then
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledTimes(1)
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledWith(
      "ses_test",
      [
        {
          filePath: "/repo/src/metadata.ts",
          before: "const b = 1\n",
          after: "// metadata comment\nconst b = 1\n",
        },
      ],
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })

  it("#given apply_patch patchText args without metadata #when hook runs #then parses patch edits", async () => {
    // given
    const hooks = createCommentCheckerHooks()
    const input = {
      tool: "apply_patch",
      sessionID: "ses_test",
      callID: "call_test",
      args: {
        patchText: [
          "*** Begin Patch",
          "*** Update File: /repo/src/raw.ts",
          "@@",
          "-const c = 1",
          "+// raw comment",
          "+const c = 1",
          "*** End Patch",
        ].join("\n"),
      },
    }
    const output = { title: "ok", output: "Success", metadata: {} }

    // when
    await hooks["tool.execute.after"](input, output)

    // then
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledTimes(1)
    expect(processApplyPatchEditsWithCli).toHaveBeenCalledWith(
      "ses_test",
      [
        {
          filePath: "/repo/src/raw.ts",
          before: "const c = 1\n",
          after: "// raw comment\nconst c = 1\n",
        },
      ],
      expect.any(Object),
      "/tmp/fake-comment-checker",
      undefined,
      expect.any(Function),
    )
  })
})
