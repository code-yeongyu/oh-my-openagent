import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, it, expect, spyOn, mock } from "bun:test"

mock.module("vscode-jsonrpc/node", () => ({
  createMessageConnection: () => {
    throw new Error("not used in unit test")
  },
  StreamMessageReader: function StreamMessageReader() {},
  StreamMessageWriter: function StreamMessageWriter() {},
}))

import { LSPClient, validateCwd } from "./client"
import type { ResolvedServer } from "./types"

describe("LSPClient", () => {
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
