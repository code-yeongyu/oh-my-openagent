/// <reference types="bun-types" />

import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import * as injectorModule from "./injector"
import * as storageModule from "./storage"
import { createDirectoryReadmeInjectorHook } from "./hook"

const mockProcessFilePathForReadmeInjection = mock(async () => {})
const mockClearInjectedPaths = mock((_sessionID: string) => {})

let processFileSpy: ReturnType<typeof spyOn> | undefined
let clearPathsSpy: ReturnType<typeof spyOn> | undefined

function setupSpies(): void {
  processFileSpy = spyOn(injectorModule, "processFilePathForReadmeInjection").mockImplementation(
    mockProcessFilePathForReadmeInjection,
  )
  clearPathsSpy = spyOn(storageModule, "clearInjectedPaths").mockImplementation(mockClearInjectedPaths)
}

function createPluginContext(directory = "/test-project"): PluginInput {
  return { directory } as PluginInput
}

describe("createDirectoryReadmeInjectorHook", () => {
  beforeEach(() => {
    setupSpies()
    mockProcessFilePathForReadmeInjection.mockReset()
    mockClearInjectedPaths.mockReset()
  })

  afterEach(() => {
    processFileSpy?.mockRestore()
    clearPathsSpy?.mockRestore()
    processFileSpy = undefined
    clearPathsSpy = undefined
  })

  describe("#given tool.execute.after", () => {
    it("#when tool is Read #then delegates to processFilePathForReadmeInjection", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)
      const input = { tool: "Read", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "/test-project/src/file.ts", output: "content", metadata: {} }

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(mockProcessFilePathForReadmeInjection).toHaveBeenCalledTimes(1)
      const callArgs = mockProcessFilePathForReadmeInjection.mock.calls[0]![0]
      expect(callArgs.filePath).toBe("/test-project/src/file.ts")
      expect(callArgs.sessionID).toBe("ses-1")
    })

    it("#when tool is read (lowercase) #then delegates to processFilePathForReadmeInjection", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)
      const input = { tool: "read", sessionID: "ses-2", callID: "call-2" }
      const output = { title: "/test-project/src/utils.ts", output: "content", metadata: {} }

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(mockProcessFilePathForReadmeInjection).toHaveBeenCalledTimes(1)
    })

    it("#when tool is not Read #then does not delegate", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)
      const input = { tool: "Bash", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "Result", output: "content", metadata: {} }

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(mockProcessFilePathForReadmeInjection).not.toHaveBeenCalled()
    })

    it("#when tool is Write #then does not delegate", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)
      const input = { tool: "Write", sessionID: "ses-1", callID: "call-1" }
      const output = { title: "Result", output: "content", metadata: {} }

      // when
      await hook["tool.execute.after"](input, output)

      // then
      expect(mockProcessFilePathForReadmeInjection).not.toHaveBeenCalled()
    })
  })

  describe("#given event handler", () => {
    it("#when session.deleted event fires #then clears session cache", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)

      // when
      await hook.event({ event: { type: "session.deleted", properties: { sessionID: "ses-1" } } })

      // then
      expect(mockClearInjectedPaths).toHaveBeenCalledWith("ses-1")
    })

    it("#when session.compacted event fires #then clears session cache", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)

      // when
      await hook.event({ event: { type: "session.compacted", properties: { sessionID: "ses-2" } } })

      // then
      expect(mockClearInjectedPaths).toHaveBeenCalledWith("ses-2")
    })

    it("#when unrelated event fires #then does not clear cache", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)

      // when
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "ses-1" } } })

      // then
      expect(mockClearInjectedPaths).not.toHaveBeenCalled()
    })

    it("#when session.deleted has no sessionID #then does not clear cache", async () => {
      // given
      const ctx = createPluginContext()
      const hook = createDirectoryReadmeInjectorHook(ctx)

      // when
      await hook.event({ event: { type: "session.deleted", properties: {} } })

      // then
      expect(mockClearInjectedPaths).not.toHaveBeenCalled()
    })
  })
})
