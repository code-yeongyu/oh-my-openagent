import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

import { describe, it, expect, spyOn, mock, beforeEach, afterEach } from "bun:test"

mock.module("vscode-jsonrpc/node", () => ({
  createMessageConnection: () => {
    throw new Error("not used in unit test")
  },
  StreamMessageReader: function StreamMessageReader() {},
  StreamMessageWriter: function StreamMessageWriter() {},
}))

import { LSPClient, lspManager, validateCwd } from "./client"
import type { ResolvedServer } from "./types"

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
        return 0 as unknown as ReturnType<typeof setTimeout>
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
        client as unknown as { sendNotification: (m: string, p?: unknown) => void },
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

  describe("diagnostics", () => {
    it("polls diagnosticsStore when pull fails and push arrives during poll window", async () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-diagnostics-test-"))
      const filePath = join(dir, "test.ts")
      writeFileSync(filePath, "const a = 1\n")

      const originalSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number) => {
        fn()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const client = new LSPClient(dir, server)

      // Mock sendRequest to throw (pull fails)
      const sendRequestSpy = spyOn(
        client as unknown as { sendRequest: (m: string, p?: unknown) => Promise<unknown> },
        "sendRequest"
      )
      sendRequestSpy.mockImplementation(async () => {
        throw new Error("pull not supported")
      })

      // Mock openFile to avoid actual file operations
      const openFileSpy = spyOn(client, "openFile")
      openFileSpy.mockImplementation(async () => {})

      try {
        // #when
        const expectedDiagnostics = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, message: "error" }]
        const absPath = resolve(filePath)
        const uri = pathToFileURL(absPath).href

        // Pre-populate store to simulate push notification that arrived before poll
        ;(client as unknown as { diagnosticsStore: Map<string, unknown> }).diagnosticsStore.set(uri, expectedDiagnostics)

        const result = await client.diagnostics(filePath)

        // #then
        expect(result.items).toEqual(expectedDiagnostics)
      } finally {
        globalThis.setTimeout = originalSetTimeout
        sendRequestSpy.mockRestore()
        openFileSpy.mockRestore()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("returns empty array when pull fails and no push arrives within timeout", async () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-diagnostics-timeout-test-"))
      const filePath = join(dir, "test.ts")
      writeFileSync(filePath, "const a = 1\n")

      const originalSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number) => {
        fn()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout

      const dateNowSpy = spyOn(Date, "now")
      let callCount = 0
      dateNowSpy.mockImplementation(() => {
        callCount++
        return callCount <= 2 ? 0 : 10_000
      })

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const client = new LSPClient(dir, server)

      // Mock sendRequest to throw (pull fails)
      const sendRequestSpy = spyOn(
        client as unknown as { sendRequest: (m: string, p?: unknown) => Promise<unknown> },
        "sendRequest"
      )
      sendRequestSpy.mockImplementation(async () => {
        throw new Error("pull not supported")
      })

      // Mock openFile to avoid actual file operations
      const openFileSpy = spyOn(client, "openFile")
      openFileSpy.mockImplementation(async () => {})

      try {
        // #when
        const result = await client.diagnostics(filePath)

        // #then
        expect(result.items).toEqual([])
      } finally {
        globalThis.setTimeout = originalSetTimeout
        dateNowSpy.mockRestore()
        sendRequestSpy.mockRestore()
        openFileSpy.mockRestore()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("returns empty diagnostics immediately when push delivers clean file during poll", async () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-diagnostics-empty-test-"))
      const filePath = join(dir, "test.ts")
      writeFileSync(filePath, "const a = 1\n")

      const originalSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = ((fn: (...args: unknown[]) => void, _ms?: number) => {
        fn()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const client = new LSPClient(dir, server)

      const sendRequestSpy = spyOn(
        client as unknown as { sendRequest: (m: string, p?: unknown) => Promise<unknown> },
        "sendRequest"
      )
      sendRequestSpy.mockImplementation(async () => {
        throw new Error("pull not supported")
      })

      const openFileSpy = spyOn(client, "openFile")
      openFileSpy.mockImplementation(async () => {})

      try {
        // #when
        const absPath = resolve(filePath)
        const uri = pathToFileURL(absPath).href
        ;(client as unknown as { diagnosticsStore: Map<string, unknown[]> }).diagnosticsStore.set(uri, [])

        const result = await client.diagnostics(filePath)

        // #then
        expect(result.items).toEqual([])
      } finally {
        globalThis.setTimeout = originalSetTimeout
        sendRequestSpy.mockRestore()
        openFileSpy.mockRestore()
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it("returns pull result immediately without polling when pull succeeds", async () => {
      // #given
      const dir = mkdtempSync(join(tmpdir(), "lsp-diagnostics-pull-success-test-"))
      const filePath = join(dir, "test.ts")
      writeFileSync(filePath, "const a = 1\n")

      const server: ResolvedServer = {
        id: "typescript",
        command: ["typescript-language-server", "--stdio"],
        extensions: [".ts"],
        priority: 0,
      }

      const client = new LSPClient(dir, server)

      const pullDiagnostics = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, message: "pull error" }]

      // Mock sendRequest to return diagnostics (pull succeeds)
      const sendRequestSpy = spyOn(
        client as unknown as { sendRequest: (m: string, p?: unknown) => Promise<unknown> },
        "sendRequest"
      )
      sendRequestSpy.mockImplementation(async () => ({
        items: pullDiagnostics,
      }))

      // Mock openFile to avoid actual file operations
      const openFileSpy = spyOn(client, "openFile")
      openFileSpy.mockImplementation(async () => {})

      try {
        // #when
        const startTime = Date.now()
        const result = await client.diagnostics(filePath)
        const elapsed = Date.now() - startTime

        // #then
        expect(result.items).toEqual(pullDiagnostics)
        // Should return quickly without waiting for poll timeout
        expect(elapsed).toBeLessThan(1000)
      } finally {
        sendRequestSpy.mockRestore()
        openFileSpy.mockRestore()
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
