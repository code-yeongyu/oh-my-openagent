const { describe, test, expect, mock } = require("bun:test")

describe("executeSync", () => {
  test("passes question=false via tools parameter to block question tool", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
      safeCompress: mock((data: unknown) => String(data)),
    }

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const args = {
      subagent_type: "explore",
      description: "test task",
      prompt: "find something",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-1",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: { promptAsync },
      },
    }

    //#when
    await executeSync(args, toolContext, ctx as any, deps)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.question).toBe(false)
  })

  test("passes task=false via tools parameter", async () => {
    //#given
    const { executeSync } = require("./sync-executor")

    const deps = {
      createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
      waitForCompletion: mock(async () => {}),
      processMessages: mock(async () => "agent response"),
      safeCompress: mock((data: unknown) => String(data)),
    }

    let promptArgs: any
    const promptAsync = mock(async (input: any) => {
      promptArgs = input
      return { data: {} }
    })

    const args = {
      subagent_type: "librarian",
      description: "search docs",
      prompt: "find docs",
    }

    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg-2",
      agent: "sisyphus",
      abort: new AbortController().signal,
      metadata: mock(async () => {}),
    }

    const ctx = {
      client: {
        session: { promptAsync },
      },
    }

    //#when
    await executeSync(args, toolContext, ctx as any, deps)

    //#then
    expect(promptAsync).toHaveBeenCalled()
    expect(promptArgs.body.tools.task).toBe(false)
  })

  describe("#compression", () => {
    test("calls safeCompress with responseText and compressionConfig", async () => {
      //#given
      const { executeSync } = require("./sync-executor")

      let compressedData: unknown
      let receivedConfig: unknown
      const mockSafeCompress = mock((data: unknown, config: unknown) => {
        compressedData = data
        receivedConfig = config
        return "compressed-result"
      })

      const deps = {
        createOrGetSession: mock(async () => ({ sessionID: "ses-test-123", isNew: true })),
        waitForCompletion: mock(async () => {}),
        processMessages: mock(async () => "agent response text"),
        safeCompress: mockSafeCompress,
      }

      const promptAsync = mock(async () => ({ data: {} }))

      const args = {
        subagent_type: "explore",
        description: "test task",
        prompt: "find something",
      }

      const toolContext = {
        sessionID: "parent-session",
        messageID: "msg-1",
        agent: "sisyphus",
        abort: new AbortController().signal,
        metadata: mock(async () => {}),
      }

      const ctx = {
        client: {
          session: { promptAsync },
        },
      }

      const compressionConfig = { enabled: true, threshold: 100 }

      //#when
      await executeSync(args, toolContext, ctx as any, deps, compressionConfig)

      //#then
      expect(mockSafeCompress).toHaveBeenCalled()
      expect(compressedData).toBe("agent response text")
      expect(receivedConfig).toEqual(compressionConfig)
    })

    test("uses compressed response in output", async () => {
      //#given
      const { executeSync } = require("./sync-executor")

      const deps = {
        createOrGetSession: mock(async () => ({ sessionID: "ses-test-456", isNew: true })),
        waitForCompletion: mock(async () => {}),
        processMessages: mock(async () => "original response"),
        safeCompress: mock(() => "COMPRESSED_DATA"),
      }

      const promptAsync = mock(async () => ({ data: {} }))

      const args = {
        subagent_type: "explore",
        description: "test task",
        prompt: "find something",
      }

      const toolContext = {
        sessionID: "parent-session",
        messageID: "msg-1",
        agent: "sisyphus",
        abort: new AbortController().signal,
        metadata: mock(async () => {}),
      }

      const ctx = {
        client: {
          session: { promptAsync },
        },
      }

      const compressionConfig = { enabled: true, threshold: 100 }

      //#when
      const result = await executeSync(args, toolContext, ctx as any, deps, compressionConfig)

      //#then
      expect(result).toContain("COMPRESSED_DATA")
      expect(result).not.toContain("original response")
      expect(result).toContain("ses-test-456")
    })

    test("uses default compression config when not provided", async () => {
      //#given
      const { executeSync, DEFAULT_COMPRESSION_CONFIG } = require("./sync-executor")

      const deps = {
        createOrGetSession: mock(async () => ({ sessionID: "ses-test-789", isNew: true })),
        waitForCompletion: mock(async () => {}),
        processMessages: mock(async () => "agent response"),
        safeCompress: mock(() => "safe-result"),
      }

      const promptAsync = mock(async () => ({ data: {} }))

      const args = {
        subagent_type: "explore",
        description: "test task",
        prompt: "find something",
      }

      const toolContext = {
        sessionID: "parent-session",
        messageID: "msg-1",
        agent: "sisyphus",
        abort: new AbortController().signal,
        metadata: mock(async () => {}),
      }

      const ctx = {
        client: {
          session: { promptAsync },
        },
      }

      //#when
      const result = await executeSync(args, toolContext, ctx as any, deps)

      //#then
      expect(DEFAULT_COMPRESSION_CONFIG).toBeDefined()
      expect(DEFAULT_COMPRESSION_CONFIG.enabled).toBe(false)
      expect(DEFAULT_COMPRESSION_CONFIG.threshold).toBe(5000)
      expect(result).toContain("safe-result")
    })
  })
})
