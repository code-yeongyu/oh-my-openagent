import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { FileReadRegistry } from "../../src/hooks/read-before-write/registry"
import {
  DEFAULT_CONFIG,
  ERROR_MESSAGES,
  WARNING_MESSAGES,
  MAX_TRACKED_FILES,
  HOOK_NAME,
} from "../../src/hooks/read-before-write/constants"
import { createReadBeforeWriteHook } from "../../src/hooks/read-before-write"
import type { ReadBeforeWriteConfig } from "../../src/hooks/read-before-write/types"
import type { PluginInput } from "@opencode-ai/plugin"
import * as fs from "node:fs"

const createMockCtx = (directory = "/project"): PluginInput =>
  ({
    directory,
    config: {},
    platform: "darwin",
    version: "1.0.0",
  }) as unknown as PluginInput

describe("FileReadRegistry", () => {
  beforeEach(() => {
    FileReadRegistry.resetInstance()
  })

  afterEach(() => {
    FileReadRegistry.resetInstance()
  })

  describe("getInstance", () => {
    test("should return singleton instance", () => {
      const instance1 = FileReadRegistry.getInstance()
      const instance2 = FileReadRegistry.getInstance()
      expect(instance1).toBe(instance2)
    })

    test("should accept config on first call", () => {
      const config: Partial<ReadBeforeWriteConfig> = { mode: "warn" }
      const instance = FileReadRegistry.getInstance(config)
      expect(instance.getConfig().mode).toBe("warn")
    })

    test("should ignore config on subsequent calls", () => {
      const instance1 = FileReadRegistry.getInstance({ mode: "warn" })
      const instance2 = FileReadRegistry.getInstance({ mode: "block" })
      expect(instance2.getConfig().mode).toBe("warn") // First config wins
    })
  })

  describe("resetInstance", () => {
    test("should allow creating new instance after reset", () => {
      const instance1 = FileReadRegistry.getInstance({ mode: "warn" })
      FileReadRegistry.resetInstance()
      const instance2 = FileReadRegistry.getInstance({ mode: "block" })
      expect(instance2.getConfig().mode).toBe("block")
    })

    test("should clear all data on reset", () => {
      const instance = FileReadRegistry.getInstance()
      instance.recordRead("session1", "/path/to/file.ts")
      FileReadRegistry.resetInstance()
      const newInstance = FileReadRegistry.getInstance()
      expect(newInstance.hasRead("session1", "/path/to/file.ts")).toBe(false)
    })
  })

  describe("recordRead", () => {
    test("should track file read for session", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file.ts")
      expect(registry.hasRead("session1", "/path/to/file.ts")).toBe(true)
    })

    test("should track multiple files for same session", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file1.ts")
      registry.recordRead("session1", "/path/to/file2.ts")
      expect(registry.hasRead("session1", "/path/to/file1.ts")).toBe(true)
      expect(registry.hasRead("session1", "/path/to/file2.ts")).toBe(true)
    })

    test("should track same file for different sessions", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file.ts")
      registry.recordRead("session2", "/path/to/file.ts")
      expect(registry.hasRead("session1", "/path/to/file.ts")).toBe(true)
      expect(registry.hasRead("session2", "/path/to/file.ts")).toBe(true)
    })

    test("should update timestamp on re-read (LRU behavior)", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file1.ts")
      registry.recordRead("session1", "/path/to/file2.ts")
      // Re-read file1 - should move to end
      registry.recordRead("session1", "/path/to/file1.ts")
      // Both should still be tracked
      expect(registry.hasRead("session1", "/path/to/file1.ts")).toBe(true)
      expect(registry.hasRead("session1", "/path/to/file2.ts")).toBe(true)
    })
  })

  describe("hasRead", () => {
    test("should return false for unread file", () => {
      const registry = FileReadRegistry.getInstance()
      expect(registry.hasRead("session1", "/path/to/file.ts")).toBe(false)
    })

    test("should return false for unknown session", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file.ts")
      expect(registry.hasRead("session2", "/path/to/file.ts")).toBe(false)
    })

    test("should return true for read file", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file.ts")
      expect(registry.hasRead("session1", "/path/to/file.ts")).toBe(true)
    })

    test("should be case-sensitive for file paths", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/File.ts")
      expect(registry.hasRead("session1", "/path/to/File.ts")).toBe(true)
      expect(registry.hasRead("session1", "/path/to/file.ts")).toBe(false)
    })
  })

  describe("clearSession", () => {
    test("should remove all files for session", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file1.ts")
      registry.recordRead("session1", "/path/to/file2.ts")
      registry.clearSession("session1")
      expect(registry.hasRead("session1", "/path/to/file1.ts")).toBe(false)
      expect(registry.hasRead("session1", "/path/to/file2.ts")).toBe(false)
    })

    test("should not affect other sessions", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file.ts")
      registry.recordRead("session2", "/path/to/file.ts")
      registry.clearSession("session1")
      expect(registry.hasRead("session1", "/path/to/file.ts")).toBe(false)
      expect(registry.hasRead("session2", "/path/to/file.ts")).toBe(true)
    })

    test("should handle clearing non-existent session gracefully", () => {
      const registry = FileReadRegistry.getInstance()
      // Should not throw
      expect(() => registry.clearSession("nonexistent")).not.toThrow()
    })
  })

  describe("getStats", () => {
    test("should return empty stats for new registry", () => {
      const registry = FileReadRegistry.getInstance()
      const stats = registry.getStats()
      expect(stats.sessionCount).toBe(0)
      expect(stats.totalFilesTracked).toBe(0)
      expect(stats.filesPerSession.size).toBe(0)
    })

    test("should return correct stats after tracking", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file1.ts")
      registry.recordRead("session1", "/path/to/file2.ts")
      registry.recordRead("session2", "/path/to/file3.ts")

      const stats = registry.getStats()
      expect(stats.sessionCount).toBe(2)
      expect(stats.totalFilesTracked).toBe(3)
      expect(stats.filesPerSession.get("session1")).toBe(2)
      expect(stats.filesPerSession.get("session2")).toBe(1)
    })

    test("should update stats after clearing session", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file1.ts")
      registry.recordRead("session2", "/path/to/file2.ts")
      registry.clearSession("session1")

      const stats = registry.getStats()
      expect(stats.sessionCount).toBe(1)
      expect(stats.totalFilesTracked).toBe(1)
    })
  })

  describe("reset", () => {
    test("should clear all sessions and files", () => {
      const registry = FileReadRegistry.getInstance()
      registry.recordRead("session1", "/path/to/file1.ts")
      registry.recordRead("session2", "/path/to/file2.ts")
      registry.reset()

      const stats = registry.getStats()
      expect(stats.sessionCount).toBe(0)
      expect(stats.totalFilesTracked).toBe(0)
    })
  })

  describe("LRU eviction", () => {
    test("should evict oldest entry when exceeding MAX_TRACKED_FILES", () => {
      const registry = FileReadRegistry.getInstance()
      const sessionId = "session1"

      // Fill to max capacity
      for (let i = 0; i < MAX_TRACKED_FILES; i++) {
        registry.recordRead(sessionId, `/path/to/file${i}.ts`)
      }

      // Verify all files are tracked
      expect(registry.hasRead(sessionId, "/path/to/file0.ts")).toBe(true)
      expect(registry.hasRead(sessionId, `/path/to/file${MAX_TRACKED_FILES - 1}.ts`)).toBe(true)

      // Add one more - should evict the oldest (file0)
      registry.recordRead(sessionId, "/path/to/newfile.ts")

      // file0 should be evicted
      expect(registry.hasRead(sessionId, "/path/to/file0.ts")).toBe(false)
      // newfile should be tracked
      expect(registry.hasRead(sessionId, "/path/to/newfile.ts")).toBe(true)
      // file1 should still be tracked
      expect(registry.hasRead(sessionId, "/path/to/file1.ts")).toBe(true)
    })

    test("should maintain LRU order on re-read", () => {
      const registry = FileReadRegistry.getInstance()
      const sessionId = "session1"

      // Fill to max capacity
      for (let i = 0; i < MAX_TRACKED_FILES; i++) {
        registry.recordRead(sessionId, `/path/to/file${i}.ts`)
      }

      // Re-read file0 - moves it to end (most recently used)
      registry.recordRead(sessionId, "/path/to/file0.ts")

      // Add new file - should evict file1 (now oldest)
      registry.recordRead(sessionId, "/path/to/newfile.ts")

      // file0 should still be tracked (was re-read)
      expect(registry.hasRead(sessionId, "/path/to/file0.ts")).toBe(true)
      // file1 should be evicted (was oldest after file0 re-read)
      expect(registry.hasRead(sessionId, "/path/to/file1.ts")).toBe(false)
    })
  })

  describe("updateConfig", () => {
    test("should update configuration", () => {
      const registry = FileReadRegistry.getInstance({ mode: "block" })
      expect(registry.getConfig().mode).toBe("block")

      registry.updateConfig({ mode: "warn" })
      expect(registry.getConfig().mode).toBe("warn")
    })

    test("should merge with existing config", () => {
      const registry = FileReadRegistry.getInstance({
        mode: "block",
        exempt_tools: ["tool1"],
      })

      registry.updateConfig({ mode: "warn" })

      const config = registry.getConfig()
      expect(config.mode).toBe("warn")
      expect(config.exempt_tools).toContain("tool1")
    })
  })

  describe("getConfig", () => {
    test("should return copy of config", () => {
      const registry = FileReadRegistry.getInstance({ mode: "block" })
      const config1 = registry.getConfig()
      const config2 = registry.getConfig()

      // Should be equal but not same reference
      expect(config1).toEqual(config2)
      expect(config1).not.toBe(config2)
    })
  })
})

/* -------------------------------------------------------------------------- */
/*                              Constants Tests                               */
/* -------------------------------------------------------------------------- */

describe("Constants", () => {
  describe("HOOK_NAME", () => {
    test("should be defined", () => {
      expect(HOOK_NAME).toBe("read-before-write")
    })
  })

  describe("MAX_TRACKED_FILES", () => {
    test("should be 10000", () => {
      expect(MAX_TRACKED_FILES).toBe(10000)
    })
  })

  describe("DEFAULT_CONFIG", () => {
    test("should have enabled true by default", () => {
      expect(DEFAULT_CONFIG.enabled).toBe(true)
    })

    test("should have mode block by default", () => {
      expect(DEFAULT_CONFIG.mode).toBe("block")
    })

    test("should have exempt_tools defined", () => {
      expect(DEFAULT_CONFIG.exempt_tools).toBeDefined()
      expect(Array.isArray(DEFAULT_CONFIG.exempt_tools)).toBe(true)
    })

    test("should exempt LSP tools", () => {
      expect(DEFAULT_CONFIG.exempt_tools).toContain("lsp_rename")
      expect(DEFAULT_CONFIG.exempt_tools).toContain("lsp_code_action_resolve")
    })

    test("should exempt memory tools", () => {
      expect(DEFAULT_CONFIG.exempt_tools).toContain("memory_write")
      expect(DEFAULT_CONFIG.exempt_tools).toContain("memory_edit")
      expect(DEFAULT_CONFIG.exempt_tools).toContain("memory_delete")
    })

    test("should exempt ast_grep_replace", () => {
      expect(DEFAULT_CONFIG.exempt_tools).toContain("ast_grep_replace")
    })

    test("should exempt workflow tools", () => {
      expect(DEFAULT_CONFIG.exempt_tools).toContain("create_spec_folder")
      expect(DEFAULT_CONFIG.exempt_tools).toContain("update_workflow_state")
    })

    test("should have exempt_paths defined", () => {
      expect(DEFAULT_CONFIG.exempt_paths).toBeDefined()
      expect(Array.isArray(DEFAULT_CONFIG.exempt_paths)).toBe(true)
    })

    test("should exempt common build directories", () => {
      expect(DEFAULT_CONFIG.exempt_paths).toContain("dist/**")
      expect(DEFAULT_CONFIG.exempt_paths).toContain("build/**")
      expect(DEFAULT_CONFIG.exempt_paths).toContain("node_modules/**")
      expect(DEFAULT_CONFIG.exempt_paths).toContain(".git/**")
    })
  })

  describe("ERROR_MESSAGES", () => {
    test("blocked should include file path", () => {
      const message = ERROR_MESSAGES.blocked("/path/to/file.ts")
      expect(message).toContain("/path/to/file.ts")
    })

    test("blocked should include BLOCKED prefix", () => {
      const message = ERROR_MESSAGES.blocked("/path/to/file.ts")
      expect(message).toContain("[BLOCKED]")
    })

    test("blocked should include action instruction", () => {
      const message = ERROR_MESSAGES.blocked("/path/to/file.ts")
      expect(message).toContain("Read tool")
      expect(message).toContain("before editing")
    })
  })

  describe("WARNING_MESSAGES", () => {
    test("noRead should include file path", () => {
      const message = WARNING_MESSAGES.noRead("/path/to/file.ts")
      expect(message).toContain("/path/to/file.ts")
    })

    test("noRead should include WARNING prefix", () => {
      const message = WARNING_MESSAGES.noRead("/path/to/file.ts")
      expect(message).toContain("[WARNING]")
    })

    test("missingSession should return warning message", () => {
      const message = WARNING_MESSAGES.missingSession()
      expect(message).toContain("[WARNING]")
      expect(message).toContain("Missing sessionID")
      expect(message).toContain("fail-open")
    })
  })
})

/* -------------------------------------------------------------------------- */
/*                      createReadBeforeWriteHook Tests                       */
/* -------------------------------------------------------------------------- */

describe("createReadBeforeWriteHook", () => {
  beforeEach(() => {
    FileReadRegistry.resetInstance()
  })

  afterEach(() => {
    FileReadRegistry.resetInstance()
  })

  describe("disabled states", () => {
    test("should return null when enabled is false", () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { enabled: false })
      expect(hook).toBeNull()
    })

    test("should return null when mode is disabled", () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "disabled" })
      expect(hook).toBeNull()
    })

    test("should return null when both enabled false and mode disabled", () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { enabled: false, mode: "disabled" })
      expect(hook).toBeNull()
    })
  })

  describe("enabled states", () => {
    test("should return hook handlers when enabled", () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { enabled: true, mode: "block" })
      expect(hook).not.toBeNull()
      expect(hook!["tool.execute.before"]).toBeDefined()
      expect(hook!.event).toBeDefined()
    })

    test("should return hook handlers with default config", () => {
      const hook = createReadBeforeWriteHook(createMockCtx())
      expect(hook).not.toBeNull()
    })
  })

  describe("tool.execute.before handler", () => {
    describe("read tracking", () => {
      test("should track file reads", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        await handler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)
      })

      test("should handle file_path arg variant", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        await handler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { file_path: "/project/src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)
      })

      test("should handle path arg variant", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        await handler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { path: "/project/src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)
      })

      test("should resolve relative paths", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        await handler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)
      })

      test("should be case-insensitive for tool name", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        await handler(
          { tool: "READ", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)
      })
    })

    describe("missing sessionID", () => {
      test("should skip enforcement when sessionID is missing", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        // Should not throw even for existing file without read
        await expect(
          handler(
            { tool: "edit", sessionID: "", callID: "call1" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).resolves.toBeUndefined()
      })

      test("should skip enforcement when sessionID is undefined", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        await expect(
          handler(
            { tool: "edit", sessionID: undefined as unknown as string, callID: "call1" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).resolves.toBeUndefined()
      })
    })

    describe("tool exemptions", () => {
      test("should skip enforcement for exempt tools", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        // Mock existsSync to return true (file exists)
        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        // lsp_rename is exempt by default
        await expect(
          handler(
            { tool: "lsp_rename", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })

      test("should skip enforcement for memory_write", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "memory_write", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/.memory/file.md" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })

      test("should skip enforcement for custom exempt tools", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), {
          exempt_tools: ["custom_tool"],
        })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "custom_tool", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })
    })

    describe("path exemptions", () => {
      test("should skip enforcement for exempt paths", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        // dist/** is exempt by default
        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/dist/bundle.js" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })

      test("should skip enforcement for node_modules", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/node_modules/pkg/index.js" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })

      test("should skip enforcement for custom exempt paths", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), {
          exempt_paths: ["generated/**"],
        })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/generated/types.ts" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })
    })

    describe("new file creation (DD-8)", () => {
      test("should allow write to new file without prior read", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        // File doesn't exist
        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(false)

        await expect(
          handler(
            { tool: "write", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/src/newfile.ts" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })

      test("should track new file write as read for subsequent edits", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        // First call: file doesn't exist (new file)
        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(false)

        await handler(
          { tool: "write", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/newfile.ts" } }
        )

        // Verify it was tracked as read
        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/newfile.ts")).toBe(true)

        existsSyncSpy.mockRestore()
      })

      test("should allow edit after write to new file", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const handler = hook["tool.execute.before"]

        // First: write to new file (doesn't exist)
        let existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(false)

        await handler(
          { tool: "write", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/newfile.ts" } }
        )

        existsSyncSpy.mockRestore()

        // Second: edit the file (now exists)
        existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        // Should not throw because write tracked it as read
        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call2" },
            { args: { filePath: "/project/src/newfile.ts" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })
    })

    describe("block mode enforcement", () => {
      test("should throw error when editing existing file without read", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).rejects.toThrow("[BLOCKED]")

        existsSyncSpy.mockRestore()
      })

      test("should throw error when writing to existing file without read", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "write", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).rejects.toThrow("[BLOCKED]")

        existsSyncSpy.mockRestore()
      })

      test("should allow edit after read", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        // First: read the file
        await handler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )

        // Second: edit the file (exists)
        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call2" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })

      test("should include file path in error message", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        try {
          await handler(
            { tool: "edit", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/src/specific-file.ts" } }
          )
          expect.unreachable("Should have thrown")
        } catch (error) {
          expect((error as Error).message).toContain("/project/src/specific-file.ts")
        }

        existsSyncSpy.mockRestore()
      })
    })

    describe("warn mode enforcement", () => {
      test("should not throw when editing existing file without read", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "warn" })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        // Should not throw in warn mode
        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call1" },
            { args: { filePath: "/project/src/file.ts" } }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })
    })

    describe("multiedit handling", () => {
      test("should check each file in multiedit", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "multiedit", sessionID: "session1", callID: "call1" },
            {
              args: {
                edits: [
                  { filePath: "/project/src/file1.ts", oldString: "a", newString: "b" },
                  { filePath: "/project/src/file2.ts", oldString: "c", newString: "d" },
                ],
              },
            }
          )
        ).rejects.toThrow("[BLOCKED]")

        existsSyncSpy.mockRestore()
      })

      test("should handle file_path variant in multiedit", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "multiedit", sessionID: "session1", callID: "call1" },
            {
              args: {
                edits: [{ file_path: "/project/src/file.ts", oldString: "a", newString: "b" }],
              },
            }
          )
        ).rejects.toThrow("[BLOCKED]")

        existsSyncSpy.mockRestore()
      })

      test("should allow multiedit when all files were read", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        // Read both files first
        await handler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file1.ts" } }
        )
        await handler(
          { tool: "read", sessionID: "session1", callID: "call2" },
          { args: { filePath: "/project/src/file2.ts" } }
        )

        const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

        await expect(
          handler(
            { tool: "multiedit", sessionID: "session1", callID: "call3" },
            {
              args: {
                edits: [
                  { filePath: "/project/src/file1.ts", oldString: "a", newString: "b" },
                  { filePath: "/project/src/file2.ts", oldString: "c", newString: "d" },
                ],
              },
            }
          )
        ).resolves.toBeUndefined()

        existsSyncSpy.mockRestore()
      })

      test("should handle empty edits array", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        await expect(
          handler(
            { tool: "multiedit", sessionID: "session1", callID: "call1" },
            { args: { edits: [] } }
          )
        ).resolves.toBeUndefined()
      })

      test("should handle undefined edits", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        await expect(
          handler(
            { tool: "multiedit", sessionID: "session1", callID: "call1" },
            { args: {} }
          )
        ).resolves.toBeUndefined()
      })

      test("should handle edits with missing filePath", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        await expect(
          handler(
            { tool: "multiedit", sessionID: "session1", callID: "call1" },
            {
              args: {
                edits: [{ oldString: "a", newString: "b" }],
              },
            }
          )
        ).resolves.toBeUndefined()
      })
    })

    describe("non-write tools", () => {
      test("should not enforce for non-write tools", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        // grep, glob, etc. should not be enforced
        await expect(
          handler(
            { tool: "grep", sessionID: "session1", callID: "call1" },
            { args: { pattern: "test" } }
          )
        ).resolves.toBeUndefined()
      })

      test("should not enforce for bash tool", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        await expect(
          handler(
            { tool: "bash", sessionID: "session1", callID: "call1" },
            { args: { command: "ls -la" } }
          )
        ).resolves.toBeUndefined()
      })
    })

    describe("missing filePath", () => {
      test("should handle missing filePath in write tool", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        await expect(
          handler(
            { tool: "write", sessionID: "session1", callID: "call1" },
            { args: {} }
          )
        ).resolves.toBeUndefined()
      })

      test("should handle missing filePath in edit tool", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
        const handler = hook["tool.execute.before"]

        await expect(
          handler(
            { tool: "edit", sessionID: "session1", callID: "call1" },
            { args: { oldString: "a", newString: "b" } }
          )
        ).resolves.toBeUndefined()
      })
    })
  })

  describe("event handler", () => {
    describe("session.deleted", () => {
      test("should clear session on session.deleted event", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const toolHandler = hook["tool.execute.before"]
        const eventHandler = hook.event

        // Track a file
        await toolHandler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)

        // Trigger session.deleted
        await eventHandler({
          event: {
            type: "session.deleted",
            properties: { info: { id: "session1" } },
          },
        })

        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(false)
      })

      test("should handle session.deleted without info", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const eventHandler = hook.event

        // Should not throw
        await expect(
          eventHandler({
            event: {
              type: "session.deleted",
              properties: {},
            },
          })
        ).resolves.toBeUndefined()
      })

      test("should handle session.deleted without properties", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const eventHandler = hook.event

        await expect(
          eventHandler({
            event: {
              type: "session.deleted",
            },
          })
        ).resolves.toBeUndefined()
      })
    })

    describe("session.compacted", () => {
      test("should clear session on session.compacted event with sessionID", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const toolHandler = hook["tool.execute.before"]
        const eventHandler = hook.event

        // Track a file
        await toolHandler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)

        // Trigger session.compacted with sessionID
        await eventHandler({
          event: {
            type: "session.compacted",
            properties: { sessionID: "session1" },
          },
        })

        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(false)
      })

      test("should clear session on session.compacted event with info.id", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const toolHandler = hook["tool.execute.before"]
        const eventHandler = hook.event

        // Track a file
        await toolHandler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )

        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)

        // Trigger session.compacted with info.id
        await eventHandler({
          event: {
            type: "session.compacted",
            properties: { info: { id: "session1" } },
          },
        })

        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(false)
      })
    })

    describe("other events", () => {
      test("should ignore unrelated events", async () => {
        const hook = createReadBeforeWriteHook(createMockCtx())!
        const toolHandler = hook["tool.execute.before"]
        const eventHandler = hook.event

        // Track a file
        await toolHandler(
          { tool: "read", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )

        // Trigger unrelated event
        await eventHandler({
          event: {
            type: "message.created",
            properties: { sessionID: "session1" },
          },
        })

        // File should still be tracked
        const registry = FileReadRegistry.getInstance()
        expect(registry.hasRead("session1", "/project/src/file.ts")).toBe(true)
      })
    })
  })

  describe("session isolation (US-2)", () => {
    test("should isolate reads between sessions", async () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
      const handler = hook["tool.execute.before"]

      // Session 1 reads file
      await handler(
        { tool: "read", sessionID: "session1", callID: "call1" },
        { args: { filePath: "/project/src/file.ts" } }
      )

      const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

      // Session 1 can edit
      await expect(
        handler(
          { tool: "edit", sessionID: "session1", callID: "call2" },
          { args: { filePath: "/project/src/file.ts" } }
        )
      ).resolves.toBeUndefined()

      // Session 2 cannot edit (hasn't read)
      await expect(
        handler(
          { tool: "edit", sessionID: "session2", callID: "call3" },
          { args: { filePath: "/project/src/file.ts" } }
        )
      ).rejects.toThrow("[BLOCKED]")

      existsSyncSpy.mockRestore()
    })
  })

  describe("config merging", () => {
    test("should merge partial config with defaults", () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "warn" })
      expect(hook).not.toBeNull()
      // Hook was created with warn mode, defaults should be merged
    })

    test("should allow adding to exempt_tools", async () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), {
        exempt_tools: [...DEFAULT_CONFIG.exempt_tools, "my_custom_tool"],
      })!
      const handler = hook["tool.execute.before"]

      const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

      // Custom tool should be exempt
      await expect(
        handler(
          { tool: "my_custom_tool", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/src/file.ts" } }
        )
      ).resolves.toBeUndefined()

      existsSyncSpy.mockRestore()
    })

    test("should allow adding to exempt_paths", async () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), {
        exempt_paths: [...DEFAULT_CONFIG.exempt_paths, "custom/**"],
      })!
      const handler = hook["tool.execute.before"]

      const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

      // Custom path should be exempt
      await expect(
        handler(
          { tool: "edit", sessionID: "session1", callID: "call1" },
          { args: { filePath: "/project/custom/file.ts" } }
        )
      ).resolves.toBeUndefined()

      existsSyncSpy.mockRestore()
    })
  })
})

/* -------------------------------------------------------------------------- */
/*                            Integration Tests                               */
/* -------------------------------------------------------------------------- */

describe("Integration Tests", () => {
  beforeEach(() => {
    FileReadRegistry.resetInstance()
  })

  afterEach(() => {
    FileReadRegistry.resetInstance()
  })

  describe("complete workflow", () => {
    test("should support read -> edit -> edit workflow", async () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
      const handler = hook["tool.execute.before"]

      // Step 1: Read file
      await handler(
        { tool: "read", sessionID: "session1", callID: "call1" },
        { args: { filePath: "/project/src/file.ts" } }
      )

      const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

      // Step 2: First edit
      await expect(
        handler(
          { tool: "edit", sessionID: "session1", callID: "call2" },
          { args: { filePath: "/project/src/file.ts" } }
        )
      ).resolves.toBeUndefined()

      // Step 3: Second edit (still allowed, read is remembered)
      await expect(
        handler(
          { tool: "edit", sessionID: "session1", callID: "call3" },
          { args: { filePath: "/project/src/file.ts" } }
        )
      ).resolves.toBeUndefined()

      existsSyncSpy.mockRestore()
    })

    test("should support create -> edit workflow (DD-8)", async () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
      const handler = hook["tool.execute.before"]

      // Step 1: Create new file (doesn't exist)
      let existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(false)

      await handler(
        { tool: "write", sessionID: "session1", callID: "call1" },
        { args: { filePath: "/project/src/newfile.ts", content: "// new file" } }
      )

      existsSyncSpy.mockRestore()

      // Step 2: Edit the file (now exists)
      existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

      await expect(
        handler(
          { tool: "edit", sessionID: "session1", callID: "call2" },
          { args: { filePath: "/project/src/newfile.ts" } }
        )
      ).resolves.toBeUndefined()

      existsSyncSpy.mockRestore()
    })

    test("should handle multiple sessions concurrently", async () => {
      const hook = createReadBeforeWriteHook(createMockCtx(), { mode: "block" })!
      const handler = hook["tool.execute.before"]

      // Session 1 reads file A
      await handler(
        { tool: "read", sessionID: "session1", callID: "call1" },
        { args: { filePath: "/project/src/fileA.ts" } }
      )

      // Session 2 reads file B
      await handler(
        { tool: "read", sessionID: "session2", callID: "call2" },
        { args: { filePath: "/project/src/fileB.ts" } }
      )

      const existsSyncSpy = spyOn(fs, "existsSync").mockReturnValue(true)

      // Session 1 can edit A, not B
      await expect(
        handler(
          { tool: "edit", sessionID: "session1", callID: "call3" },
          { args: { filePath: "/project/src/fileA.ts" } }
        )
      ).resolves.toBeUndefined()

      await expect(
        handler(
          { tool: "edit", sessionID: "session1", callID: "call4" },
          { args: { filePath: "/project/src/fileB.ts" } }
        )
      ).rejects.toThrow("[BLOCKED]")

      // Session 2 can edit B, not A
      await expect(
        handler(
          { tool: "edit", sessionID: "session2", callID: "call5" },
          { args: { filePath: "/project/src/fileB.ts" } }
        )
      ).resolves.toBeUndefined()

      await expect(
        handler(
          { tool: "edit", sessionID: "session2", callID: "call6" },
          { args: { filePath: "/project/src/fileA.ts" } }
        )
      ).rejects.toThrow("[BLOCKED]")

      existsSyncSpy.mockRestore()
    })
  })
})
