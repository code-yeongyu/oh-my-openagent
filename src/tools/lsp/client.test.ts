import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, it, expect, spyOn, mock, beforeEach, afterEach, afterAll } from "bun:test"

mock.module("vscode-jsonrpc/node", () => ({
  createMessageConnection: () => {
    throw new Error("not used in unit test")
  },
  StreamMessageReader: function StreamMessageReader() {},
  StreamMessageWriter: function StreamMessageWriter() {},
}))

afterAll(() => { mock.restore() })

import { LSPClient, lspManager, validateCwd } from "./client"
import type { ResolvedServer } from "./types"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("LSPClient", () => {
  beforeEach(async () => {
    await lspManager.stopAll()
  })

  afterEach(async () => {
    await lspManager.stopAll()
  })

  describe("openFile", () => {
    it("sends didChange when a previously opened file changes on disk", async () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-client-test-"))
      const filePath = join(dir, "test.ts")
      writeFileSync(filePath, "const a = 1\n")

      const originalSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number) => {
        fn()
        return unsafeTestValue<ReturnType<typeof setTimeout>>(0)
      }) as typeof setTimeout

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const client = new LSPClient(dir, server)

      // Stub protocol output: we only want to assert notifications.
      const sendNotificationSpy = spyOn(
        unsafeTestValue<{ sendNotification: (m: string, p?: unknown) => void }>(client),
        "sendNotification"
      )

      try {
        // #when
        await client.openFile(filePath)
        writeFileSync(filePath, "const a = 2\n")
        await client.openFile(filePath)

        // #then
        const methods = sendNotificationSpy.mock.calls.map((c) => c[0])
        expect(methods).toContain("textDocument/didOpen")
        expect(methods).toContain("textDocument/didChange")
      } finally {
        globalThis.setTimeout = originalSetTimeout
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("diagnostics", () => {
    it("waits for published diagnostics before falling back to the diagnostics store", async () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-client-diagnostics-test-"))
      const filePath = join(dir, "test.ts")
      writeFileSync(filePath, "const a = 1\n")

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const client = new LSPClient(dir, server)
      const expected = [{
        message: "published later",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
      }]

      const openFileSpy = spyOn(client, "openFile")
      openFileSpy.mockImplementation(async () => {})

      const sendRequestSpy = spyOn(
        client as unknown as { sendRequest: (m: string, p?: unknown) => Promise<unknown> },
        "sendRequest"
      )
      sendRequestSpy.mockRejectedValue(new Error("not supported"))

      const originalSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number) => {
        if (ms === 100) {
          queueMicrotask(fn)
          return 0 as unknown as ReturnType<typeof setTimeout>
        }

        if (ms === 5000) {
          return 0 as unknown as ReturnType<typeof setTimeout>
        }

        return originalSetTimeout(fn as TimerHandler, 0)
      }) as typeof setTimeout

      let pollCount = 0
      const dateNowSpy = spyOn(Date, "now")
      dateNowSpy.mockImplementation(() => {
        pollCount += 1
        if (pollCount === 3) {
          ;(client as unknown as { diagnosticsStore: Map<string, unknown[]> }).diagnosticsStore.set(
            new URL(`file://${filePath}`).href,
            expected as unknown[]
          )
        }
        return pollCount * 100
      })

      try {
        // #when
        const result = await client.diagnostics(filePath)

        // #then
        expect(result.items).toEqual(expected)
        expect(openFileSpy).toHaveBeenCalledWith(filePath)
      } finally {
        openFileSpy.mockRestore()
        sendRequestSpy.mockRestore()
        dateNowSpy.mockRestore()
        globalThis.setTimeout = originalSetTimeout
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("LSPServerManager", () => {
    it("recreates client after init failure instead of staying permanently blocked", async () => {
      //#given
      const dir = mkdtempSync(join(tmpdir(), "lsp-manager-test-"))

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const startSpy = spyOn(LSPClient.prototype, "start")
      const initializeSpy = spyOn(LSPClient.prototype, "initialize")
      const isAliveSpy = spyOn(LSPClient.prototype, "isAlive")
      const stopSpy = spyOn(LSPClient.prototype, "stop")

      startSpy.mockImplementationOnce(async () => {
        throw new Error("boom")
      })
      startSpy.mockImplementation(async () => {})
      initializeSpy.mockImplementation(async () => {})
      isAliveSpy.mockImplementation(() => true)
      stopSpy.mockImplementation(async () => {})

      try {
        //#when
        await expect(lspManager.getClient(dir, server)).rejects.toThrow("boom")

        const client = await lspManager.getClient(dir, server)

        //#then
        expect(client).toBeInstanceOf(LSPClient)
        expect(startSpy).toHaveBeenCalledTimes(2)
        expect(stopSpy).toHaveBeenCalled()
      } finally {
        startSpy.mockRestore()
        initializeSpy.mockRestore()
        isAliveSpy.mockRestore()
        stopSpy.mockRestore()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("resets stale initializing entry so a hung init does not permanently block future clients", async () => {
      //#given
      const dir = mkdtempSync(join(tmpdir(), "lsp-manager-stale-test-"))

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const dateNowSpy = spyOn(Date, "now")

      const startSpy = spyOn(LSPClient.prototype, "start")
      const initializeSpy = spyOn(LSPClient.prototype, "initialize")
      const isAliveSpy = spyOn(LSPClient.prototype, "isAlive")
      const stopSpy = spyOn(LSPClient.prototype, "stop")

      // First client init hangs forever.
      const never = new Promise<void>(() => {})
      startSpy.mockImplementationOnce(async () => {
        await never
      })

      // Second attempt should be allowed after stale reset.
      startSpy.mockImplementationOnce(async () => {})
      startSpy.mockImplementation(async () => {})
      initializeSpy.mockImplementation(async () => {})
      isAliveSpy.mockImplementation(() => true)
      stopSpy.mockImplementation(async () => {})

      try {
        //#when
        dateNowSpy.mockReturnValueOnce(0)
        lspManager.warmupClient(dir, server)

        dateNowSpy.mockReturnValueOnce(60_000)

        const client = await Promise.race([
          lspManager.getClient(dir, server),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("test-timeout")), 50)),
        ])

        //#then
        expect(client).toBeInstanceOf(LSPClient)
        expect(startSpy).toHaveBeenCalledTimes(2)
        expect(stopSpy).toHaveBeenCalled()
      } finally {
        dateNowSpy.mockRestore()
        startSpy.mockRestore()
        initializeSpy.mockRestore()
        isAliveSpy.mockRestore()
        stopSpy.mockRestore()
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("validateCwd", () => {
    it("returns valid for existing directory", () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-cwd-test-"))

      try {
        // #when
        const result = validateCwd(dir)

        // #then
        expect(result.valid).toBe(true)
        expect(result.error).toBeUndefined()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("returns invalid for non-existent directory", () => {
      // #given
      const nonExistentDir = join(tmpdir(), "lsp-cwd-nonexistent-" + Date.now())

      // #when
      const result = validateCwd(nonExistentDir)

      // #then
      expect(result.valid).toBe(false)
      expect(result.error).toContain("Working directory does not exist")
    })

    it("returns invalid when path is a file", () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-cwd-file-test-"))
      const filePath = join(dir, "not-a-dir.txt")
      writeFileSync(filePath, "test content")

      try {
        // #when
        const result = validateCwd(filePath)

        // #then
        expect(result.valid).toBe(false)
        expect(result.error).toContain("Path is not a directory")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("start", () => {
    it("throws error when working directory does not exist", async () => {
      // #given
      const nonExistentDir = join(tmpdir(), "lsp-test-nonexistent-" + Date.now())
      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }
      const client = new LSPClient(nonExistentDir, server)

      // #when / #then
      await expect(client.start()).rejects.toThrow("Working directory does not exist")
    })

    it("throws error when path is a file instead of directory", async () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-client-test-"))
      const filePath = join(dir, "not-a-dir.txt")
      writeFileSync(filePath, "test content")

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }
      const client = new LSPClient(filePath, server)

      try {
        // #when / #then
        await expect(client.start()).rejects.toThrow("Path is not a directory")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
