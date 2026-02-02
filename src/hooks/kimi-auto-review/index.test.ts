import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test"
import type { KimiReviewConfig, KimiReviewResult, ToolExecuteInput, ToolExecuteOutput } from "./types"
import { DEFAULT_CONFIG, TRIGGER_TOOLS } from "./constants"

const createMockPluginInput = (overrides: {
  promptMock?: ReturnType<typeof mock>
  messagesMock?: ReturnType<typeof mock>
  createMock?: ReturnType<typeof mock>
  getMock?: ReturnType<typeof mock>
  reviewResponse?: string
} = {}) => {
  const promptCalls: Array<{ sessionID: string; agent: string; text: string }> = []
  
  const getMock = overrides.getMock ?? mock(async () => ({
    data: { directory: "/test/project" }
  }))

  const createMock = overrides.createMock ?? mock(async () => ({
    data: { id: "review-session-123" }
  }))

  const promptMock = overrides.promptMock ?? mock(async (opts: {
    path: { id: string }
    body: { agent: string; parts: Array<{ type: string; text: string }> }
  }) => {
    promptCalls.push({
      sessionID: opts.path.id,
      agent: opts.body.agent,
      text: opts.body.parts[0]?.text ?? "",
    })
    return {}
  })

  const defaultReviewResponse = overrides.reviewResponse ?? "REVIEW: APPROVED\n\nNo issues found."
  const messagesMock = overrides.messagesMock ?? mock(async () => ({
    data: [{ 
      info: { 
        role: "assistant",
        time: { created: Date.now() }
      },
      parts: [{ type: "text", text: defaultReviewResponse }]
    }]
  }))

  return {
    ctx: {
      client: {
        session: {
          get: getMock,
          create: createMock,
          prompt: promptMock,
          messages: messagesMock,
        },
        app: {
          agents: mock(async () => ({ data: [] })),
        },
        tui: {
          showToast: mock(async () => ({})),
        },
      },
      directory: "/test/project",
    },
    promptCalls,
    promptMock,
    messagesMock,
    createMock,
    getMock,
  }
}

describe("kimi-auto-review hook", () => {
  describe("hook creation", () => {
    test("should create hook with default config", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)

      expect(hook).toBeDefined()
      expect(hook["tool.execute.after"]).toBeDefined()
      expect(typeof hook["tool.execute.after"]).toBe("function")
    })

    test("should create hook with custom config", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx } = createMockPluginInput()

      const customConfig: KimiReviewConfig = {
        enabled: false,
        model: "custom/model",
        blockOnCritical: false,
      }

      const hook = createKimiAutoReviewHook(ctx as any, { config: customConfig })

      expect(hook).toBeDefined()
    })
  })

  describe("trigger conditions", () => {
    test("should trigger on 'write' tool", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { title: "Write", output: "Wrote file", metadata: { filePath: "/src/file.ts" } }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).toHaveBeenCalled()
    })

    test("should trigger on 'edit' tool", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "edit", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { title: "Edit", output: "Edited file", metadata: { filePath: "/src/file.ts" } }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).toHaveBeenCalled()
    })

    test("should trigger on 'Write' tool (case insensitive)", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "Write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { title: "Write", output: "Wrote file", metadata: { filePath: "/src/file.ts" } }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).toHaveBeenCalled()
    })

    test("should NOT trigger on 'read' tool", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "read", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { title: "Read", output: "File content", metadata: {} }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).not.toHaveBeenCalled()
    })

    test("should NOT trigger on 'bash' tool", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "bash", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { title: "Bash", output: "Command output", metadata: {} }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).not.toHaveBeenCalled()
    })
  })

  describe("file filtering", () => {
    test("should review .ts files by default", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { 
        title: "Write", 
        output: "Wrote file", 
        metadata: { filePath: "/src/file.ts" } 
      }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).toHaveBeenCalled()
    })

    test("should skip .txt files when reviewThreshold is code-only", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any, {
        config: { reviewThreshold: "code-only" }
      })
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { 
        title: "Write", 
        output: "Wrote file", 
        metadata: { filePath: "/src/notes.txt" } 
      }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).not.toHaveBeenCalled()
    })

    test("should skip test files matching ignorePatterns", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { 
        title: "Write", 
        output: "Wrote file", 
        metadata: { filePath: "/src/file.test.ts" } 
      }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).not.toHaveBeenCalled()
    })

    test("should respect custom extensions config", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any, {
        config: { extensions: [".md"], ignorePatterns: [] }
      })
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { 
        title: "Write", 
        output: "Wrote file", 
        metadata: { filePath: "/src/README.md" } 
      }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).toHaveBeenCalled()
    })
  })

  describe("disabled state", () => {
    test("should skip review when enabled=false", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const { ctx, promptMock } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any, { config: { enabled: false } })
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { 
        title: "Write", 
        output: "Wrote file", 
        metadata: { filePath: "/src/file.ts" } 
      }

      await hook["tool.execute.after"]?.(input, output)

      expect(promptMock).not.toHaveBeenCalled()
    })
  })

  describe("output injection", () => {
    test("should inject review summary into output.output for approved review", async () => {
      const { createKimiAutoReviewHook, parseReviewResponse } = await import("./index")
      const { ctx } = createMockPluginInput()

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { 
        title: "Write", 
        output: "Wrote file", 
        metadata: { filePath: "/src/file.ts" } 
      }

      await hook["tool.execute.after"]?.(input, output)

      expect(output.output).toContain("[KIMI REVIEW]")
    })
  })

  describe("error handling", () => {
    test("should handle API errors gracefully", async () => {
      const { createKimiAutoReviewHook } = await import("./index")
      const errorMock = mock(async () => {
        throw new Error("API Error")
      })
      const { ctx } = createMockPluginInput({ promptMock: errorMock })

      const hook = createKimiAutoReviewHook(ctx as any)
      const input: ToolExecuteInput = { tool: "write", sessionID: "test-session", callID: "call-1" }
      const output: ToolExecuteOutput = { 
        title: "Write", 
        output: "Wrote file", 
        metadata: { filePath: "/src/file.ts" } 
      }

      const result = await hook["tool.execute.after"]?.(input, output)
      expect(result).toBeUndefined()
    })
  })
})

describe("parseReviewResponse", () => {
  test("should parse APPROVED verdict", async () => {
    const { parseReviewResponse } = await import("./index")

    const response = "REVIEW: APPROVED\n\nNo issues found."
    const result = parseReviewResponse(response)

    expect(result.verdict).toBe("APPROVED")
    expect(result.issues).toHaveLength(0)
  })

  test("should parse ISSUES_FOUND with CRITICAL issues", async () => {
    const { parseReviewResponse } = await import("./index")

    const response = `REVIEW: ISSUES_FOUND

[CRITICAL]
- SQL injection vulnerability in query builder
  File: src/db.ts:42
  Fix: Use parameterized queries`

    const result = parseReviewResponse(response)

    expect(result.verdict).toBe("ISSUES_FOUND")
    expect(result.issues.some(i => i.severity === "CRITICAL")).toBe(true)
    expect(result.issues[0].file).toBe("src/db.ts")
    expect(result.issues[0].line).toBe(42)
    expect(result.issues[0].suggestion).toBe("Use parameterized queries")
  })

  test("should parse ISSUES_FOUND with WARNING issues", async () => {
    const { parseReviewResponse } = await import("./index")

    const response = `REVIEW: ISSUES_FOUND

[WARNING]
- Missing error handling for async operation
  Suggestion: Add try-catch block`

    const result = parseReviewResponse(response)

    expect(result.verdict).toBe("ISSUES_FOUND")
    expect(result.issues.some(i => i.severity === "WARNING")).toBe(true)
    expect(result.issues[0].suggestion).toBe("Add try-catch block")
  })

  test("should parse ISSUES_FOUND with STYLE issues", async () => {
    const { parseReviewResponse } = await import("./index")

    const response = `REVIEW: ISSUES_FOUND

[STYLE]
- Inconsistent naming convention`

    const result = parseReviewResponse(response)

    expect(result.verdict).toBe("ISSUES_FOUND")
    expect(result.issues.some(i => i.severity === "STYLE")).toBe(true)
  })

  test("should parse mixed severity issues", async () => {
    const { parseReviewResponse } = await import("./index")

    const response = `REVIEW: ISSUES_FOUND

[CRITICAL]
- Security issue

[WARNING]
- Performance concern

[STYLE]
- Naming convention`

    const result = parseReviewResponse(response)

    expect(result.verdict).toBe("ISSUES_FOUND")
    expect(result.issues).toHaveLength(3)
  })
})
