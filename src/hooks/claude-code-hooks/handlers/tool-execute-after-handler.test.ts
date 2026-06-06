import { beforeEach, describe, expect, it, mock, afterAll } from "bun:test"
import { restoreModuleMocksForTestFile } from "../../../testing/module-mock-lifecycle"

type PostToolUseMockResult = {
  block?: boolean
  reason?: string
  message?: string
  warnings?: string[]
  additionalContext?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const transcriptCalls: Array<[string, unknown]> = []
const appendTranscriptEntry = mock((sessionId: string, entry: unknown) => {
  transcriptCalls.push([sessionId, entry])
})
let postToolUseResult: PostToolUseMockResult = { warnings: [] }

mock.module("../config", () => ({
  loadClaudeHooksConfig: async () => ({}),
}))

mock.module("../config-loader", () => ({
  loadPluginExtendedConfig: async () => ({}),
}))

mock.module("../post-tool-use", () => ({
  executePostToolUseHooks: async () => postToolUseResult,
}))

mock.module("../transcript", () => ({
  appendTranscriptEntry,
  getTranscriptPath: () => "/tmp/transcript.jsonl",
}))

afterAll(() => {
  mock.restore()
  restoreModuleMocksForTestFile(import.meta.url)
})

const { createToolExecuteAfterHandler } = await import("./tool-execute-after-handler")

describe("createToolExecuteAfterHandler", () => {
  beforeEach(() => {
    appendTranscriptEntry.mockClear()
    transcriptCalls.length = 0
    postToolUseResult = { warnings: [] }
  })

  it("#given diff-heavy metadata #when transcript entry is appended #then it keeps concise output with compact metadata", async () => {
    const handler = createToolExecuteAfterHandler(
      {
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
        directory: "/repo",
      } as never,
      { disabledHooks: ["PostToolUse"] }
    )

    await handler(
      { tool: "hashline_edit", sessionID: "ses_test", callID: "call_test" },
      {
        title: "src/example.ts",
        output: "Updated src/example.ts",
        metadata: {
          filePath: "src/example.ts",
          path: "src/duplicate-path.ts",
          file: "src/duplicate-file.ts",
          sessionId: "ses_oracle",
          agent: "oracle",
          prompt: "very large hidden prompt",
          diff: "x".repeat(5000),
          noopEdits: 1,
          deduplicatedEdits: 2,
          firstChangedLine: 42,
          filediff: {
            before: "before body",
            after: "after body",
            additions: 3,
            deletions: 4,
          },
          nested: {
            keep: false,
          },
        },
      }
    )

    expect(appendTranscriptEntry).toHaveBeenCalledTimes(1)

    const firstCall = transcriptCalls[0]
    const sessionId = firstCall?.[0]
    const entry = firstCall?.[1]
    expect(sessionId).toBe("ses_test")
    expect(entry).toBeDefined()
    if (!entry || typeof entry !== "object" || !("tool_output" in entry)) {
      throw new Error("expected transcript entry with tool_output")
    }

    const toolOutput = entry.tool_output
    expect(toolOutput).toBeDefined()
    if (!isRecord(toolOutput)) {
      throw new Error("expected compact tool_output object")
    }

    expect(entry).toMatchObject({
      type: "tool_result",
      tool_name: "hashline_edit",
      tool_input: {},
      tool_output: {
        output: "Updated src/example.ts",
        filePath: "src/example.ts",
        sessionId: "ses_oracle",
        agent: "oracle",
        noopEdits: 1,
        deduplicatedEdits: 2,
        firstChangedLine: 42,
        filediff: {
          additions: 3,
          deletions: 4,
        },
      },
    })

    expect(entry).toHaveProperty("timestamp")
    expect(toolOutput).not.toHaveProperty("diff")
    expect(toolOutput).not.toHaveProperty("path")
    expect(toolOutput).not.toHaveProperty("file")
    expect(toolOutput).not.toHaveProperty("prompt")
    expect(toolOutput).not.toHaveProperty("nested")

    const filediff = toolOutput.filediff
    expect(filediff).toBeDefined()
    if (!isRecord(filediff)) {
      throw new Error("expected compact filediff object")
    }
    expect(filediff).not.toHaveProperty("before")
    expect(filediff).not.toHaveProperty("after")
  })

  it("#given multiline PostToolUse context on empty tool output #when output is appended #then it renders clean normalized sections", async () => {
    // given
    postToolUseResult = {
      warnings: ["\r\nWarning line\r\n  warning detail\r\n"],
      additionalContext: "\r\nContext line\r\n  context detail\r",
      message: "\r\nMessage line\r\nmessage detail\r\n",
    }
    const handler = createToolExecuteAfterHandler(
      {
        client: {
          tui: {
            showToast: async () => ({}),
          },
        },
        directory: "/repo",
      } as never,
      { disabledHooks: [] }
    )
    const output = {
      title: "tool",
      output: "",
      metadata: {},
    }

    // when
    await handler({ tool: "write", sessionID: "ses_test", callID: "call_test" }, output)

    // then
    expect(output.output).toBe(
      [
        "Warning line\n  warning detail",
        "Context line\n  context detail",
        "Message line\nmessage detail",
      ].join("\n\n")
    )
    expect(output.output).not.toContain("\r")
  })

  it("#given warning toast rejects with a non-Error value #when PostToolUse blocks #then output still receives hook sections", async () => {
    // given
    const thrownValue = "toast failed"
    postToolUseResult = {
      block: true,
      reason: "warn",
      warnings: ["warning from hook"],
    }
    const handler = createToolExecuteAfterHandler(
      {
        client: {
          tui: {
            showToast: async () => {
              throw thrownValue
            },
          },
        },
        directory: "/repo",
      } as never,
      { disabledHooks: [] }
    )
    const output = {
      title: "tool",
      output: "",
      metadata: {},
    }

    // when
    await handler({ tool: "write", sessionID: "ses_test", callID: "call_test" }, output)

    // then
    expect(output.output).toBe("warning from hook")
  })
})
