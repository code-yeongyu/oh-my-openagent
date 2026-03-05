import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { clearSessionAgent } from "../../features/claude-code-session-state"

// Force stable (JSON) mode for tests that rely on message file storage
mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const { createCoeusMdOnlyHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

describe("coeus-md-only", () => {
  const TEST_SESSION_ID = "ses_test_coeus"
  let testMessageDir: string

  function createMockPluginInput() {
    return {
      client: {},
      directory: "/tmp/test-coeus",
    } as never
  }

  function setupMessageStorage(sessionID: string, agent: string | undefined): void {
    testMessageDir = join(MESSAGE_STORAGE, sessionID)
    mkdirSync(testMessageDir, { recursive: true })
    const messageContent = {
      ...(agent ? { agent } : {}),
      model: { providerID: "test", modelID: "test-model" },
    }
    writeFileSync(
      join(testMessageDir, "msg_001.json"),
      JSON.stringify(messageContent)
    )
  }

  afterEach(() => {
    clearSessionAgent(TEST_SESSION_ID)
    if (testMessageDir) {
      try {
        rmSync(testMessageDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  describe("agent matching - coeus and sub-prometheus", () => {
    //#given coeus agent attempts to write a .ts file
    //#when the hook intercepts the Write tool call
    //#then it should block the write
    test("should block coeus from writing .ts files", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "coeus")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given sub-prometheus agent attempts to write outside .sisyphus/
    //#when the hook intercepts the Write tool call
    //#then it should block the write
    test("should block sub-prometheus from writing outside .sisyphus/", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "sub-prometheus")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/code.js" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given coeus display name (Coeus (Recursive Planner)) writes a .ts file
    //#when the hook intercepts
    //#then it should block
    test("should enforce restriction for Coeus display name", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "Coeus (Recursive Planner)")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given uppercase COEUS agent name
    //#when the hook intercepts
    //#then it should block (case-insensitive)
    test("should enforce restriction for uppercase COEUS", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "COEUS")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })
  })

  describe("non-coeus agents completely unaffected", () => {
    //#given sisyphus agent writes a .ts file
    //#when the hook intercepts
    //#then it should allow (not a coeus agent)
    test("should not affect sisyphus agent", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "sisyphus")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given atlas agent writes a .ts file
    //#when the hook intercepts
    //#then it should allow (not a coeus agent)
    test("should not affect atlas agent", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "atlas")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given prometheus agent writes a .ts file
    //#when the coeus hook intercepts
    //#then it should allow (prometheus has its own hook)
    test("should not affect prometheus agent", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "prometheus")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given no agent found (undefined)
    //#when the hook intercepts
    //#then it should allow
    test("should not enforce when agent is undefined", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, undefined)
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })
  })

  describe("allowed writes - .sisyphus/ md and json", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "coeus")
    })

    //#given coeus writes a plan .md in .sisyphus/plans/
    //#when the hook intercepts
    //#then it should allow
    test("should allow coeus to write .sisyphus/plans/my-plan.md", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/plans/my-plan.md" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given coeus writes a sub-plan .json in .sisyphus/sub-plans/
    //#when the hook intercepts
    //#then it should allow
    test("should allow coeus to write .sisyphus/sub-plans/session-id/auth.json", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/sub-plans/ses_abc/auth.json" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given coeus writes a .md in .sisyphus/drafts/
    //#when the hook intercepts
    //#then it should allow (any .md under .sisyphus/)
    test("should allow coeus to write .sisyphus/drafts/notes.md", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/drafts/notes.md" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given coeus writes a brief .md in .sisyphus/briefs/
    //#when the hook intercepts
    //#then it should allow (.md only in briefs/)
    test("should allow coeus to write .sisyphus/briefs/auth-system-20260305.md", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/briefs/auth-system-20260305.md" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given coeus writes a bet-record .json in .sisyphus/bet-records/
    //#when the hook intercepts
    //#then it should allow (.json only in bet-records/)
    test("should allow coeus to write .sisyphus/bet-records/auth-system-20260305.json", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/bet-records/auth-system-20260305.json" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })
  })

  describe("blocked writes", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "coeus")
    })

    //#given coeus writes a .ts file
    //#when the hook intercepts
    //#then it should block
    test("should block coeus from writing .ts files", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/code.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given coeus writes .md OUTSIDE .sisyphus/
    //#when the hook intercepts
    //#then it should block
    test("should block coeus from writing .md outside .sisyphus/", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/README.md" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given coeus writes boulder.json (managed by Atlas)
    //#when the hook intercepts
    //#then it should block
    test("should block coeus from writing .sisyphus/boulder.json", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/boulder.json" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given coeus Edit tool for non-allowed files
    //#when the hook intercepts
    //#then it should block
    test("should block Edit tool for non-allowed files", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Edit", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/code.py" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given coeus writes .json in .sisyphus/briefs/ (only .md allowed)
    //#when the hook intercepts
    //#then it should block
    test("should block coeus from writing .sisyphus/briefs/auth-system.json", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/briefs/auth-system.json" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given coeus writes .ts in .sisyphus/bet-records/ (only .json allowed)
    //#when the hook intercepts
    //#then it should block
    test("should block coeus from writing .sisyphus/bet-records/auth-system.ts", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/bet-records/auth-system.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })
  })

  describe("read operations always allowed", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "coeus")
    })

    //#given coeus reads a .ts file
    //#when the hook intercepts
    //#then it should allow (reads never blocked)
    test("should allow Read tool for any file", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Read", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given coeus runs bash command
    //#when the hook intercepts
    //#then it should allow (not a write tool)
    test("should allow bash commands", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "bash", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { command: "ls -la" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given coeus calls Glob tool
    //#when the hook intercepts
    //#then it should allow
    test("should allow Glob tool", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Glob", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { pattern: "**/*.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })
  })

  describe("missing filePath handling", () => {
    //#given coeus calls Write with no filePath
    //#when the hook intercepts
    //#then it should pass through gracefully
    test("should handle missing filePath gracefully", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "coeus")
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: {} }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })
  })

  describe("sub-prometheus specific", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "sub-prometheus")
    })

    //#given sub-prometheus writes .sisyphus/sub-plans/auth.json
    //#when the hook intercepts
    //#then it should allow
    test("should allow sub-prometheus to write sub-plans json", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/sub-plans/task/plan.json" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })

    //#given sub-prometheus writes .ts
    //#when the hook intercepts
    //#then it should block
    test("should block sub-prometheus from writing .ts files", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/path/to/code.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })

    //#given sub-prometheus writes boulder.json
    //#when the hook intercepts
    //#then it should block (boulder managed by Atlas)
    test("should block sub-prometheus from writing boulder.json", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: TEST_SESSION_ID, callID: "call-1" }
      const output = { args: { filePath: "/tmp/test-coeus/.sisyphus/boulder.json" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).rejects.toThrow(
        "can only write/edit"
      )
    })
  })

  describe("without message storage", () => {
    //#given no session found
    //#when the hook intercepts
    //#then it should pass through (no agent = no restriction)
    test("should handle missing session gracefully", async () => {
      //#given
      const hook = createCoeusMdOnlyHook(createMockPluginInput())
      const input = { tool: "Write", sessionID: "ses_non_existent", callID: "call-1" }
      const output = { args: { filePath: "/path/to/file.ts" } }

      //#when //#then
      await expect(hook["tool.execute.before"](input, output)).resolves.toBeUndefined()
    })
  })
})
