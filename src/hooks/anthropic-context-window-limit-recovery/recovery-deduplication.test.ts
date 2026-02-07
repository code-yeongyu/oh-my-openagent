import { describe, test, expect, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ExperimentalConfig } from "../../config"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function createImmediateTimeouts(): () => void {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
    callback(...args)
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout

  globalThis.clearTimeout = ((_: ReturnType<typeof setTimeout>) => {}) as typeof clearTimeout

  return () => {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

describe("createAnthropicContextWindowLimitRecoveryHook", () => {
  test("attempts deduplication recovery when compaction hits prompt too long errors", async () => {
    const restoreTimeouts = createImmediateTimeouts()
    const originalDataHome = process.env.XDG_DATA_HOME
    const tempHome = mkdtempSync(join(tmpdir(), "omo-context-"))
    process.env.XDG_DATA_HOME = tempHome

    const storageRoot = join(tempHome, "opencode", "storage")
    const messageDir = join(storageRoot, "message", "session-96")
    const partDir = join(storageRoot, "part", "message-1")
    const partDirTwo = join(storageRoot, "part", "message-2")

    mkdirSync(messageDir, { recursive: true })
    mkdirSync(partDir, { recursive: true })
    mkdirSync(partDirTwo, { recursive: true })

    writeJson(join(messageDir, "message-1.json"), {
      parts: [
        {
          type: "tool",
          callID: "call-1",
          tool: "read",
          state: { input: { filePath: "/tmp/a.txt" } },
        },
      ],
    })

    writeJson(join(messageDir, "message-2.json"), {
      parts: [
        {
          type: "tool",
          callID: "call-2",
          tool: "read",
          state: { input: { filePath: "/tmp/a.txt" } },
        },
      ],
    })

    writeJson(join(partDir, "part-1.json"), {
      id: "part-1",
      sessionID: "session-96",
      messageID: "message-1",
      type: "tool",
      callID: "call-1",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/tmp/a.txt" },
        output: "duplicate output",
      },
    })

    writeJson(join(partDirTwo, "part-2.json"), {
      id: "part-2",
      sessionID: "session-96",
      messageID: "message-2",
      type: "tool",
      callID: "call-2",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/tmp/a.txt" },
        output: "latest output",
      },
    })

    const experimental = {
      dynamic_context_pruning: {
        enabled: true,
        strategies: {
          deduplication: { enabled: true },
        },
      },
    } satisfies ExperimentalConfig

    let resolveSummarize: (() => void) | null = null
    const summarizePromise = new Promise<void>((resolve) => {
      resolveSummarize = resolve
    })

    const mockClient = {
      session: {
        messages: mock(() => Promise.resolve({ data: [] })),
        summarize: mock(() => summarizePromise),
        revert: mock(() => Promise.resolve()),
        prompt_async: mock(() => Promise.resolve()),
      },
      tui: {
        showToast: mock(() => Promise.resolve()),
      },
    }

    try {
      const { createAnthropicContextWindowLimitRecoveryHook } = await import("./recovery-hook")
      const ctx = { client: mockClient, directory: "/tmp" } as PluginInput
      const hook = createAnthropicContextWindowLimitRecoveryHook(ctx, { experimental })

      // given - initial token limit error schedules compaction
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-96", error: "prompt is too long" },
        },
      })

      // when - compaction hits another prompt-too-long error
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "session-96", error: "prompt is too long" },
        },
      })

      // then - duplicate tool output is truncated
      const prunedPart = JSON.parse(
        readFileSync(join(partDir, "part-1.json"), "utf-8"),
      ) as { truncated?: boolean }

      expect(prunedPart.truncated).toBe(true)
    } finally {
      if (resolveSummarize) resolveSummarize()
      restoreTimeouts()
      process.env.XDG_DATA_HOME = originalDataHome
      rmSync(tempHome, { recursive: true, force: true })
    }
  })
})
