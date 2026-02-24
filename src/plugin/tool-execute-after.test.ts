const { beforeEach, describe, expect, mock, test } = require("bun:test")

const safeCompressMock = mock(() => "toon:compressed")
const shouldCompressMock = mock(() => true)

mock.module("../shared/toon-compression", () => ({
  safeCompress: safeCompressMock,
  shouldCompress: shouldCompressMock,
}))

const { createToolExecuteAfterHandler } = require("./tool-execute-after")

describe("createToolExecuteAfterHandler", () => {
  beforeEach(() => {
    safeCompressMock.mockReset()
    safeCompressMock.mockImplementation(() => "toon:compressed")
    shouldCompressMock.mockReset()
    shouldCompressMock.mockImplementation(() => true)
  })

  test("compresses eligible JSON output before truncation hook", async () => {
    const hooks = {
      toolOutputTruncator: {
        "tool.execute.after": async (_input: unknown, output: { output: string }) => {
          expect(output.output).toBe("toon:compressed")
        },
      },
    }

    const handler = createToolExecuteAfterHandler({
      hooks,
      pluginConfig: { toon_compression: { enabled: true, threshold: 42 } },
    })

    const payload = Array.from({ length: 8 }, (_item, index) => ({ path: `file-${index}.ts`, mtime: index }))
    const output = { title: "glob", output: JSON.stringify(payload), metadata: {} }

    await handler({ tool: "glob", sessionID: "ses_1", callID: "call_1" }, output)

    expect(shouldCompressMock).toHaveBeenCalledTimes(1)
    expect(shouldCompressMock).toHaveBeenCalledWith(payload, 42)
    expect(safeCompressMock).toHaveBeenCalledTimes(1)
    expect(safeCompressMock).toHaveBeenCalledWith(payload, { enabled: true, threshold: 42 })
    expect(output.output).toBe("toon:compressed")
  })

  test("does not compress plain error outputs", async () => {
    const handler = createToolExecuteAfterHandler({
      hooks: {},
      pluginConfig: { toon_compression: { enabled: true, threshold: 42 } },
    })

    const output = {
      title: "grep",
      output: "Error: unable to parse response",
      metadata: {},
    }

    await handler({ tool: "grep", sessionID: "ses_2", callID: "call_2" }, output)

    expect(shouldCompressMock).not.toHaveBeenCalled()
    expect(safeCompressMock).not.toHaveBeenCalled()
    expect(output.output).toBe("Error: unable to parse response")
  })

  test("does not compress outputs already marked as truncated", async () => {
    const handler = createToolExecuteAfterHandler({
      hooks: {},
      pluginConfig: { toon_compression: { enabled: true, threshold: 42 } },
    })

    const output = {
      title: "ast_grep_search",
      output: "[TRUNCATED] Results truncated (max output bytes)",
      metadata: {},
    }

    await handler({ tool: "ast_grep_search", sessionID: "ses_3", callID: "call_3" }, output)

    expect(shouldCompressMock).not.toHaveBeenCalled()
    expect(safeCompressMock).not.toHaveBeenCalled()
  })

  test("continues execution when compression fails", async () => {
    safeCompressMock.mockImplementation(() => {
      throw new Error("compression failed")
    })

    let truncatorRan = false
    const hooks = {
      toolOutputTruncator: {
        "tool.execute.after": async () => {
          truncatorRan = true
        },
      },
    }

    const handler = createToolExecuteAfterHandler({
      hooks,
      pluginConfig: { toon_compression: { enabled: true, threshold: 42 } },
    })

    const payload = Array.from({ length: 8 }, (_item, index) => ({ path: `file-${index}.ts`, mtime: index }))
    const output = { title: "glob", output: JSON.stringify(payload), metadata: {} }

    await expect(handler({ tool: "glob", sessionID: "ses_4", callID: "call_4" }, output)).resolves.toBeUndefined()
    expect(truncatorRan).toBe(true)
    expect(output.output).toBe(JSON.stringify(payload))
  })
})

export {}
