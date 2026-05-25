/// <reference types="bun-types" />

import { beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearPendingStore } from "../features/tool-metadata-store"
import { _flushForTesting, _resetLoggerForTesting, _setLoggerForTesting } from "../shared/logger"
import { createToolExecuteAfterHandler } from "./tool-execute-after"

function readLogIfPresent(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : ""
}

describe("createToolExecuteAfterHandler metadata recovery", () => {
  beforeEach(() => {
    clearPendingStore()
    _resetLoggerForTesting()
  })

  it("#given builtin tool has no recoverable metadata #when tool.execute.after runs #then it fails open without warning spam", async () => {
    // given
    const logDir = mkdtempSync(join(tmpdir(), "omo-tool-after-"))
    const logPath = join(logDir, "omo.log")
    _setLoggerForTesting({ filePath: logPath })
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
    })
    const output = { title: "result", output: "read output", metadata: {} }

    try {
      // when
      await handler(
        { tool: "read", sessionID: "ses_parent", callID: "call_read" },
        output,
      )
      _flushForTesting()

      // then
      expect(output).toEqual({ title: "result", output: "read output", metadata: {} })
      expect(readLogIfPresent(logPath)).not.toContain("Unable to recover stored metadata")
    } finally {
      _resetLoggerForTesting()
      rmSync(logDir, { force: true, recursive: true })
    }
  })

  it("#given call_omo_agent has no recoverable store entry #when tool.execute.after runs #then it fails open without warning spam", async () => {
    // given
    const logDir = mkdtempSync(join(tmpdir(), "omo-tool-after-"))
    const logPath = join(logDir, "omo.log")
    _setLoggerForTesting({ filePath: logPath })
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
    })
    const output = { title: "result", output: "agent output", metadata: {} }

    try {
      // when
      await handler(
        { tool: "call_omo_agent", sessionID: "ses_parent", callID: "call_agent" },
        output,
      )
      _flushForTesting()

      // then
      expect(output).toEqual({ title: "result", output: "agent output", metadata: {} })
      expect(readLogIfPresent(logPath)).not.toContain("Unable to recover stored metadata")
    } finally {
      _resetLoggerForTesting()
      rmSync(logDir, { force: true, recursive: true })
    }
  })

  it("#given metadata-linked tool has stale metadata #when tool.execute.after runs #then it warns and still completes hooks", async () => {
    // given
    const logDir = mkdtempSync(join(tmpdir(), "omo-tool-after-"))
    const logPath = join(logDir, "omo.log")
    _setLoggerForTesting({ filePath: logPath })
    let hookRan = false
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {
        categorySkillReminder: {
          "tool.execute.after": async () => {
            hookRan = true
          },
        },
      } as never,
    })

    try {
      // when
      await handler(
        { tool: "task", sessionID: "ses_parent", callID: "call_missing" },
        { title: "result", output: "task output", metadata: {} },
      )
      _flushForTesting()

      // then
      expect(hookRan).toBe(true)
      expect(readLogIfPresent(logPath)).toContain("Unable to recover stored metadata")
    } finally {
      _resetLoggerForTesting()
      rmSync(logDir, { force: true, recursive: true })
    }
  })
})
