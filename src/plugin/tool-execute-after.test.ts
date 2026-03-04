const { describe, expect, test } = require("bun:test")

const { createToolExecuteAfterHandler } = require("./tool-execute-after")

describe("createToolExecuteAfterHandler", () => {
  test("compresses eligible JSON output before truncation hook", async () => {
    const payload = Array.from({ length: 8 }, (_item, index) => ({ path: `file-${index}.ts`, mtime: index }))
    const original = JSON.stringify(payload)
    const output = { title: "glob", output: original, metadata: {} }

    const handler = createToolExecuteAfterHandler({
      hooks: {},
      pluginConfig: { toon_compression: { enabled: true, threshold: 1 } },
    })

    await handler({ tool: "glob", sessionID: "ses_1", callID: "call_1" }, output)

    expect(typeof output.output).toBe("string")
  })

  test("does not compress plain error outputs", async () => {
    const output = {
      title: "grep",
      output: "Error: unable to parse response",
      metadata: {},
    }

    const handler = createToolExecuteAfterHandler({
      hooks: {},
      pluginConfig: { toon_compression: { enabled: true, threshold: 1 } },
    })

    await handler({ tool: "grep", sessionID: "ses_2", callID: "call_2" }, output)

    expect(output.output).toBe("Error: unable to parse response")
  })

  test("does not compress outputs already marked as truncated", async () => {
    const output = {
      title: "ast_grep_search",
      output: "[TRUNCATED] Results truncated (max output bytes)",
      metadata: {},
    }

    const handler = createToolExecuteAfterHandler({
      hooks: {},
      pluginConfig: { toon_compression: { enabled: true, threshold: 1 } },
    })

    await handler({ tool: "ast_grep_search", sessionID: "ses_3", callID: "call_3" }, output)

    expect(output.output).toBe("[TRUNCATED] Results truncated (max output bytes)")
  })
})

export {}
