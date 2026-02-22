const { beforeEach, describe, expect, test } = require("bun:test")

const { createToolExecuteAfterHandler } = require("./tool-execute-after")
const { clearPendingStore, storeToolMetadata } = require("../features/tool-metadata-store")

describe("createToolExecuteAfterHandler surrogate sanitization", () => {
  beforeEach(() => {
    clearPendingStore()
  })

  test("sanitizes output title, output, and metadata", async () => {
    const handler = createToolExecuteAfterHandler({ hooks: {} })

    const input = { tool: "read", sessionID: "ses_1", callID: "call_1" }
    const output = {
      title: "title\uD800",
      output: "result\uDC00",
      metadata: {
        nested: "meta\uD800",
      },
    }

    await handler(input, output)

    expect(output.title).toBe("title\uFFFD")
    expect(output.output).toBe("result\uFFFD")
    expect(output.metadata).toEqual({ nested: "meta\uFFFD" })
  })

  test("sanitizes metadata restored from pending store", async () => {
    const handler = createToolExecuteAfterHandler({ hooks: {} })

    storeToolMetadata("ses_2", "call_2", {
      title: "stored\uD800",
      metadata: { fromStore: "value\uDC00" },
    })

    const input = { tool: "read", sessionID: "ses_2", callID: "call_2" }
    const output = {
      title: "base",
      output: "ok",
      metadata: {},
    }

    await handler(input, output)

    expect(output.title).toBe("stored\uFFFD")
    expect(output.metadata).toEqual({ fromStore: "value\uFFFD" })
  })
})

export {}
