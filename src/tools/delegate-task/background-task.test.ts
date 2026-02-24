const { describe, test, expect, beforeEach, afterEach, mock } = require("bun:test")

import { executeBackgroundTask } from "./executor"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"
import * as toonCompression from "../../shared/toon-compression"

describe("executeBackgroundTask - compression integration", () => {
  let abort: AbortController
  let metadataCalls: Array<{ title: string; metadata: Record<string, unknown> }> = []

  beforeEach(() => {
    abort = new AbortController()
    metadataCalls = []
  })

  afterEach(() => {
    mock.restore()
  })

  test("#given compression enabled, #when executing background task, #then returns formatted text (not JSON)", async () => {
    // given
    const compressionConfig: ToonCompressionConfig = {
      enabled: true,
      threshold: 100,
    }

    const ctx: ToolContextWithMetadata = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: abort.signal,
      metadata: async (input) => {
        metadataCalls.push(input)
      },
    }

    const args: DelegateTaskArgs = {
      load_skills: [],
      description: "Test task with compression",
      prompt: "Do something with structured data",
      run_in_background: true,
      category: "quick",
    }

    const executorCtx = {
      manager: {
        launch: async () => ({
          id: "task_compressed",
          description: "Test task with compression",
          prompt: "Do something with structured data",
          agent: "sisyphus-junior",
          status: "pending",
          sessionID: "ses_child_compressed",
        }),
        getTask: () => undefined,
      },
    } as any

    const parentContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
    }

    // when
    const result = await executeBackgroundTask(
      args,
      ctx,
      executorCtx,
      parentContext,
      "sisyphus-junior",
      undefined,
      undefined,
      undefined,
      compressionConfig,
    )

    // then
    expect(result).toContain("Background task launched")
    expect(result).toContain("Task ID: task_compressed")
    expect(result).toContain("Status: pending")
    // Response is formatted text, not JSON/TOON
    expect(result).not.toMatch(/^\|/) // TOON format starts with |
  })

  test("#given compression disabled, #when executing background task, #then returns formatted text", async () => {
    // given
    const compressionConfig: ToonCompressionConfig = {
      enabled: false,
      threshold: 5000,
    }

    const ctx: ToolContextWithMetadata = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: abort.signal,
      metadata: async () => {},
    }

    const args: DelegateTaskArgs = {
      load_skills: [],
      description: "Test task without compression",
      prompt: "Do something",
      run_in_background: true,
      category: "deep",
    }

    const executorCtx = {
      manager: {
        launch: async () => ({
          id: "task_no_compress",
          description: "Test task without compression",
          agent: "sisyphus-junior",
          status: "pending",
          sessionID: "ses_child_no_compress",
        }),
        getTask: () => undefined,
      },
    } as any

    const parentContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
    }

    // when
    const result = await executeBackgroundTask(
      args,
      ctx,
      executorCtx,
      parentContext,
      "sisyphus-junior",
      undefined,
      undefined,
      undefined,
      compressionConfig,
    )

    // then
    expect(result).toContain("Background task launched")
    expect(result).toContain("Task ID: task_no_compress")
  })

  test("#given default compression config, #when executing background task, #then uses default disabled state", async () => {
    // given - using default compression config (not passing the parameter)
    const ctx: ToolContextWithMetadata = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: abort.signal,
      metadata: async () => {},
    }

    const args: DelegateTaskArgs = {
      load_skills: [],
      description: "Test task default config",
      prompt: "Do something",
      run_in_background: true,
    }

    const executorCtx = {
      manager: {
        launch: async () => ({
          id: "task_default",
          description: "Test task default config",
          agent: "explore",
          status: "pending",
          sessionID: "ses_child_default",
        }),
        getTask: () => undefined,
      },
    } as any

    const parentContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
    }

    // when - not passing compression config (uses default)
    const result = await executeBackgroundTask(
      args,
      ctx,
      executorCtx,
      parentContext,
      "explore",
      undefined,
      undefined,
      undefined,
    )

    // then
    expect(result).toContain("Background task launched")
    expect(result).toContain("Task ID: task_default")
  })

  test("#given metadata with structured payload, #when task launched, #then metadata is stored correctly", async () => {
    // given
    const compressionConfig: ToonCompressionConfig = {
      enabled: true,
      threshold: 100,
    }

    const ctx: ToolContextWithMetadata = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "sisyphus",
      abort: abort.signal,
      callID: "call_123",
      metadata: async (input) => {
        metadataCalls.push(input)
      },
    }

    const args: DelegateTaskArgs = {
      load_skills: ["git-master"],
      description: "Test metadata storage",
      prompt: "Do git operations",
      run_in_background: true,
      category: "quick",
    }

    const executorCtx = {
      manager: {
        launch: async () => ({
          id: "task_meta",
          description: "Test metadata storage",
          agent: "sisyphus-junior",
          status: "pending",
          sessionID: "ses_child_meta",
        }),
        getTask: () => undefined,
      },
    } as any

    const parentContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
    }

    // when
    await executeBackgroundTask(
      args,
      ctx,
      executorCtx,
      parentContext,
      "sisyphus-junior",
      undefined,
      undefined,
      undefined,
      compressionConfig,
    )

    // then
    expect(metadataCalls.length).toBe(1)
    expect(metadataCalls[0].title).toBe("Test metadata storage")
    expect(metadataCalls[0].metadata.prompt).toBe("Do git operations")
    expect(metadataCalls[0].metadata.category).toBe("quick")
    expect(metadataCalls[0].metadata.load_skills).toEqual(["git-master"])
  })
})
