import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import { createToolOutputTruncatorHook } from "./tool-output-truncator"
import * as dynamicTruncator from "../shared/dynamic-truncator"
import * as toonCompression from "../shared/toon-compression"

describe("createToolOutputTruncatorHook", () => {
  let hook: ReturnType<typeof createToolOutputTruncatorHook>
  let truncateSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    truncateSpy = spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
      truncate: mock(async (_sessionID: string, output: string, options?: { targetMaxTokens?: number }) => ({
        result: output,
        truncated: false,
        targetMaxTokens: options?.targetMaxTokens,
      })),
      getUsage: mock(async () => null),
      truncateSync: mock(() => ({ result: "", truncated: false })),
    })
    hook = createToolOutputTruncatorHook({} as never)
  })

  describe("tool.execute.after", () => {
    const createInput = (tool: string) => ({
      tool,
      sessionID: "test-session",
      callID: "test-call-id",
    })

    const createOutput = (outputText: string) => ({
      title: "Result",
      output: outputText,
      metadata: {},
    })

    describe("#given webfetch tool", () => {
      describe("#when output is processed", () => {
        it("#then should use aggressive truncation limit (10k tokens)", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
            targetMaxTokens: options?.targetMaxTokens,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("webfetch")
          const output = createOutput("large content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalledWith(
            "test-session",
            "large content",
            { targetMaxTokens: 10_000 }
          )
        })
      })

      describe("#when using WebFetch variant", () => {
        it("#then should also use aggressive truncation limit", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("WebFetch")
          const output = createOutput("large content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalledWith(
            "test-session",
            "large content",
            { targetMaxTokens: 10_000 }
          )
        })
      })
    })

    describe("#given grep tool", () => {
      describe("#when output is processed", () => {
        it("#then should use default truncation limit (50k tokens)", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("grep")
          const output = createOutput("grep output")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalledWith(
            "test-session",
            "grep output",
            { targetMaxTokens: 50_000 }
          )
        })
      })
    })

    describe("#given non-truncatable tool", () => {
      describe("#when tool is not in TRUNCATABLE_TOOLS list", () => {
        it("#then should not call truncator", async () => {
          const truncateMock = mock(async () => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never)

          const input = createInput("Read")
          const output = createOutput("file content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).not.toHaveBeenCalled()
        })
      })
    })

    describe("#given truncate_all_tool_outputs enabled", () => {
      describe("#when any tool output is processed", () => {
        it("#then should truncate non-listed tools too", async () => {
          const truncateMock = mock(async (_sessionID: string, _output: string, options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          }))
          truncateSpy.mockReturnValue({
            truncate: truncateMock,
            getUsage: mock(async () => null),
            truncateSync: mock(() => ({ result: "", truncated: false })),
          })
          hook = createToolOutputTruncatorHook({} as never, {
            experimental: { truncate_all_tool_outputs: true },
          })

          const input = createInput("Read")
          const output = createOutput("file content")

          await hook["tool.execute.after"](input, output)

          expect(truncateMock).toHaveBeenCalled()
        })
      })
    })
  })
})


describe("compression integration", () => {
  const createUniformArray = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: i, name: `item-${i}` }))

  describe("#given compression enabled", () => {
    describe("when output is a large uniform JSON array", () => {
      it("then compresses before truncation", async () => {
        const truncateMock = mock(
          async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          })
        )
        const compressSpy = spyOn(toonCompression, "safeCompress").mockImplementation((data) => {
          if (typeof data === "string") return data
          return `COMPRESSED:${JSON.stringify(data).length}`
        })
        spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
          truncate: truncateMock,
          getUsage: mock(async () => null),
          truncateSync: mock(() => ({ result: "", truncated: false })),
        })

        const hook = createToolOutputTruncatorHook({} as never, {
          compression: { enabled: true, threshold: 100 },
        })

        const largeArray = createUniformArray(100)
        const input = { tool: "grep", sessionID: "test", callID: "test" }
        const output = { title: "Result", output: JSON.stringify(largeArray), metadata: {} }

        await hook["tool.execute.after"](input, output)

        expect(compressSpy).toHaveBeenCalled()
        expect(truncateMock).toHaveBeenCalled()
        // Verify compression happened before truncation by checking truncate received compressed output
        const truncateCallArg = truncateMock.mock.calls[0][1]
        expect(truncateCallArg).toMatch(/^COMPRESSED:/)

        compressSpy.mockRestore()
      })
    })

    describe("when output is not valid JSON", () => {
      it("then skips compression and truncates original", async () => {
        const truncateMock = mock(
          async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          })
        )
        const compressSpy = spyOn(toonCompression, "safeCompress")
        spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
          truncate: truncateMock,
          getUsage: mock(async () => null),
          truncateSync: mock(() => ({ result: "", truncated: false })),
        })

        const hook = createToolOutputTruncatorHook({} as never, {
          compression: { enabled: true, threshold: 100 },
        })

        const input = { tool: "grep", sessionID: "test", callID: "test" }
        const plainText = "This is plain text output, not JSON"
        const output = { title: "Result", output: plainText, metadata: {} }

        await hook["tool.execute.after"](input, output)

        // Should not attempt compression on non-JSON
        expect(compressSpy).not.toHaveBeenCalled()
        expect(truncateMock).toHaveBeenCalledWith("test", plainText, { targetMaxTokens: 50_000 })

        compressSpy.mockRestore()
      })
    })

    describe("when output is already TOON compressed", () => {
      it("then does not double-compress", async () => {
        const truncateMock = mock(
          async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          })
        )
        const compressSpy = spyOn(toonCompression, "safeCompress")
        spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
          truncate: truncateMock,
          getUsage: mock(async () => null),
          truncateSync: mock(() => ({ result: "", truncated: false })),
        })

        const hook = createToolOutputTruncatorHook({} as never, {
          compression: { enabled: true, threshold: 100 },
        })

        const input = { tool: "grep", sessionID: "test", callID: "test" }
        // TOON format starts with specific header (non-JSON)
        const alreadyCompressed = "\x00TOON\x01compressed-data-here"
        const output = { title: "Result", output: alreadyCompressed, metadata: {} }

        await hook["tool.execute.after"](input, output)

        // Should not attempt to compress non-JSON (already compressed)
        expect(compressSpy).not.toHaveBeenCalled()
        expect(truncateMock).toHaveBeenCalledWith("test", alreadyCompressed, { targetMaxTokens: 50_000 })

        compressSpy.mockRestore()
      })
    })
  })

  describe("#given compression disabled", () => {
    describe("when output is a large uniform JSON array", () => {
      it("then skips compression and only truncates", async () => {
        const truncateMock = mock(
          async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          })
        )
        const compressSpy = spyOn(toonCompression, "safeCompress")
        spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
          truncate: truncateMock,
          getUsage: mock(async () => null),
          truncateSync: mock(() => ({ result: "", truncated: false })),
        })

        const hook = createToolOutputTruncatorHook({} as never, {
          compression: { enabled: false, threshold: 100 },
        })

        const largeArray = createUniformArray(100)
        const input = { tool: "grep", sessionID: "test", callID: "test" }
        const originalOutput = JSON.stringify(largeArray)
        const output = { title: "Result", output: originalOutput, metadata: {} }

        await hook["tool.execute.after"](input, output)

        expect(compressSpy).not.toHaveBeenCalled()
        expect(truncateMock).toHaveBeenCalledWith("test", originalOutput, { targetMaxTokens: 50_000 })

        compressSpy.mockRestore()
      })
    })
  })

  describe("#given no compression config", () => {
    describe("when processing any output", () => {
      it("then behaves as before (truncation only)", async () => {
        const truncateMock = mock(
          async (_sessionID: string, _output: string, _options?: { targetMaxTokens?: number }) => ({
            result: "truncated",
            truncated: true,
          })
        )
        const compressSpy = spyOn(toonCompression, "safeCompress")
        spyOn(dynamicTruncator, "createDynamicTruncator").mockReturnValue({
          truncate: truncateMock,
          getUsage: mock(async () => null),
          truncateSync: mock(() => ({ result: "", truncated: false })),
        })

        const hook = createToolOutputTruncatorHook({} as never)

        const input = { tool: "grep", sessionID: "test", callID: "test" }
        const output = { title: "Result", output: "some output", metadata: {} }

        await hook["tool.execute.after"](input, output)

        expect(compressSpy).not.toHaveBeenCalled()
        expect(truncateMock).toHaveBeenCalled()

        compressSpy.mockRestore()
      })
    })
  })
})
