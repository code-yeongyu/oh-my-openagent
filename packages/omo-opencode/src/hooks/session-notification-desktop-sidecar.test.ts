/// <reference types="bun-types" />

import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import * as sender from "./session-notification-sender"
import * as utils from "./session-notification-utils"

type ExecFileCall = {
  readonly file: string
  readonly args: readonly string[]
  readonly options: {
    readonly windowsHide?: boolean
  }
}

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void
type ExecFileResult = ReturnType<typeof childProcess.execFile>

function mockExecFile(
  calls: ExecFileCall[],
  getError: (callIndex: number) => Error | null = () => null
): ReturnType<typeof spyOn> {
  return spyOn(childProcess, "execFile").mockImplementation(
    unsafeTestValue<typeof childProcess.execFile>(
      (
        file: string,
        args: readonly string[],
        options: { readonly windowsHide?: boolean },
        callback: ExecFileCallback
      ) => {
        const callIndex = calls.length
        calls.push({ file, args: [...args], options })
        callback(getError(callIndex), "", "")
        return unsafeTestValue<ExecFileResult>({})
      }
    )
  )
}

describe("session-notification Desktop sidecar fallback", () => {
  const originalBundleId = process.env.__CFBundleIdentifier

  beforeEach(() => {
    jest.restoreAllMocks()
    process.env.__CFBundleIdentifier = "com.opencode.desktop"
    spyOn(utils, "getCmuxPath").mockResolvedValue(null)
    spyOn(utils, "getTerminalNotifierPath").mockResolvedValue("/usr/local/bin/terminal-notifier")
    spyOn(utils, "getOsascriptPath").mockResolvedValue("/usr/bin/osascript")
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalBundleId === undefined) {
      delete process.env.__CFBundleIdentifier
      return
    }

    process.env.__CFBundleIdentifier = originalBundleId
  })

  describe("#given ctx.$ is unavailable in the Desktop sidecar", () => {
    test("#then macOS notifications use execFile with the bundle activation args", async () => {
      const execFileCalls: ExecFileCall[] = []
      mockExecFile(execFileCalls)
      const mockCtx = unsafeTestValue<PluginInput>({})

      await sender.sendSessionNotification(mockCtx, "darwin", "Done", "Task completed")

      expect(execFileCalls).toEqual([
        {
          file: "/usr/local/bin/terminal-notifier",
          args: [
            "-title",
            "Done",
            "-message",
            "Task completed",
            "-activate",
            "com.opencode.desktop",
          ],
          options: { windowsHide: true },
        },
      ])
    })

    test("#then macOS falls back from terminal-notifier execFile failure to osascript execFile", async () => {
      const execFileCalls: ExecFileCall[] = []
      mockExecFile(execFileCalls, (callIndex) => callIndex === 0 ? new Error("terminal-notifier failed") : null)
      const mockCtx = unsafeTestValue<PluginInput>({})

      await sender.sendSessionNotification(mockCtx, "darwin", "Done", "Task completed")

      expect(execFileCalls.length).toBe(2)
      expect(execFileCalls[0]?.file).toBe("/usr/local/bin/terminal-notifier")
      expect(execFileCalls[1]?.file).toBe("/usr/bin/osascript")
      expect(execFileCalls[1]?.args[0]).toBe("-e")
      expect(execFileCalls[1]?.args[1]).toContain('display notification "Task completed"')
      expect(execFileCalls[1]?.args[1]).toContain('with title "Done"')
      expect(execFileCalls[1]?.options.windowsHide).toBe(true)
    })
  })
})
