import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"
// Force stable (JSON) mode for tests that rely on message file storage
mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

const { createOracleMdOnlyHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

describe("oracle-md-only", () => {
  const TEST_SESSION_ID = "ses_test-session-oracle"
  let testMessageDir: string

  function createMockPluginInput() {
    return {
      client: {},
      directory: "/tmp/test",
    } as never
  }

  function setupMessageStorage(sessionID: string, agent: string | undefined, setInMemory = true): void {
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
    if (agent && setInMemory) {
      setSessionAgent(sessionID, agent)
    }
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

  describe("agent name matching", () => {
    test("should enforce md-only restriction for exact oracle agent name", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "oracle")
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      //#when //#then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should enforce md-only restriction for Oracle display name Plan Builder", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "Oracle (Plan Builder)")
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      //#when //#then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should enforce md-only restriction for Oracle display name Planner", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "Oracle (Planner)")
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      //#when //#then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should enforce md-only restriction for uppercase ORACLE", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "ORACLE")
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      //#when //#then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should not enforce restriction for non-Oracle agent", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, "morpheus")
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      //#when //#then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should not enforce restriction when agent name is undefined", async () => {
      //#given
      setupMessageStorage(TEST_SESSION_ID, undefined)
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      //#when //#then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })
  })

   describe("with Oracle agent in message storage", () => {
     beforeEach(() => {
       setupMessageStorage(TEST_SESSION_ID, "oracle")
     })

    test("should block Oracle from writing non-.md files", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should allow Oracle to write .md files inside .matrixx/", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/tmp/test/.matrixx/plans/work-plan.md" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should inject workflow reminder when Oracle writes to .matrixx/plans/", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.matrixx/plans/work-plan.md" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.message).toContain("PROMETHEUS MANDATORY WORKFLOW REMINDER")
      expect(output.message).toContain("INTERVIEW")
      expect(output.message).toContain("METIS CONSULTATION")
      expect(output.message).toContain("MOMUS REVIEW")
    })

    test("should NOT inject workflow reminder for .matrixx/drafts/", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.matrixx/drafts/notes.md" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.message).toBeUndefined()
    })

    test("should block Oracle from writing .md files outside .matrixx/", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/README.md" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files inside .matrixx/")
    })

    test("should block Edit tool for non-.md files", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Edit",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.py" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should allow bash commands from Oracle", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "bash",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { command: "echo test" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should not affect non-blocked tools", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Read",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should handle missing filePath gracefully", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should inject read-only warning when Oracle calls task", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { prompt: "Analyze this codebase" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
      expect(output.args.prompt).toContain("DO NOT modify any files")
    })

    test("should inject read-only warning when Oracle calls task", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { prompt: "Research this library" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
    })

    test("should inject read-only warning when Oracle calls call_omo_agent", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "call_omo_agent",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { prompt: "Find implementation examples" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
    })

    test("should not double-inject warning if already present", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const promptWithWarning = `Some prompt ${SYSTEM_DIRECTIVE_PREFIX} already here`
      const output = {
        args: { prompt: promptWithWarning },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      const occurrences = (output.args.prompt as string).split(SYSTEM_DIRECTIVE_PREFIX).length - 1
      expect(occurrences).toBe(1)
    })
  })

  describe("with non-Oracle agent in message storage", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "morpheus")
    })

    test("should not affect non-Oracle agents", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should not inject warning for non-Oracle agents calling task", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const originalPrompt = "Implement this feature"
      const output = {
        args: { prompt: originalPrompt },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.args.prompt).toBe(originalPrompt)
      expect(output.args.prompt).not.toContain(SYSTEM_DIRECTIVE_PREFIX)
    })
  })

  describe("mission state priority over message files (fixes #927)", () => {
    const MISSION_DIR = join(tmpdir(), `mission-test-${randomUUID()}`)
    const MISSION_FILE = join(MISSION_DIR, ".matrixx", "mission.json")

    beforeEach(() => {
      mkdirSync(join(MISSION_DIR, ".matrixx"), { recursive: true })
    })

    afterEach(() => {
      rmSync(MISSION_DIR, { recursive: true, force: true })
    })

    //#given session was started with oracle (first message), but /start-work set mission agent to architect
    //#when user types "continue" after interruption (memory cleared, falls back to message files)
    //#then should use mission state agent (architect), not message file agent (oracle)
    test("should prioritize mission agent over message file agent", async () => {
      // given - oracle in message files (from /plan)
      setupMessageStorage(TEST_SESSION_ID, "oracle", false)
      
      // given - architect in mission state (from /start-work)
      writeFileSync(MISSION_FILE, JSON.stringify({
        active_plan: "/test/plan.md",
        started_at: new Date().toISOString(),
        session_ids: [TEST_SESSION_ID],
        plan_name: "test-plan",
        agent: "architect"
      }))

      const hook = createOracleMdOnlyHook({
        client: {},
        directory: MISSION_DIR,
      } as never)

      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.ts" },
      }

      // when / then - should NOT block because mission says architect, not oracle
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should use oracle from mission state when set", async () => {
      // given - architect in message files (from some other agent)
      setupMessageStorage(TEST_SESSION_ID, "architect", false)
      
      // given - oracle in mission state (edge case, but should honor it)
      writeFileSync(MISSION_FILE, JSON.stringify({
        active_plan: "/test/plan.md",
        started_at: new Date().toISOString(),
        session_ids: [TEST_SESSION_ID],
        plan_name: "test-plan",
        agent: "oracle"
      }))

      const hook = createOracleMdOnlyHook({
        client: {},
        directory: MISSION_DIR,
      } as never)

      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.ts" },
      }

      // when / then - should block because mission says oracle
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should fall back to message files when session not in mission", async () => {
      // given - oracle in message files
      setupMessageStorage(TEST_SESSION_ID, "oracle")
      
      // given - mission state exists but for different session
      writeFileSync(MISSION_FILE, JSON.stringify({
        active_plan: "/test/plan.md",
        started_at: new Date().toISOString(),
        session_ids: ["ses_other_session_id"],
        plan_name: "test-plan",
        agent: "architect"
      }))

      const hook = createOracleMdOnlyHook({
        client: {},
        directory: MISSION_DIR,
      } as never)

      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.ts" },
      }

      // when / then - should block because falls back to message files (oracle)
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })
  })

  describe("without message storage", () => {
    test("should handle missing session gracefully (no agent found)", async () => {
      // given
      const hook = createOracleMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: "ses_non_existent_session",
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })
  })

  describe("cross-platform path validation", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "oracle")
    })

     test("should allow Windows-style backslash paths under .matrixx/", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".matrixx\\plans\\work-plan.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow mixed separator paths under .matrixx/", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".matrixx\\plans/work-plan.MD" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow uppercase .MD extension", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".matrixx/plans/work-plan.MD" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block paths outside workspace root even if containing .matrixx", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "/other/project/.matrixx/plans/x.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside .matrixx/")
     })

     test("should allow nested .matrixx directories (ctx.directory may be parent)", async () => {
       // given - when ctx.directory is parent of actual project, path includes project name
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "src/.matrixx/plans/x.md" },
       }

       // when / #then - should allow because .matrixx is in path
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block path traversal attempts", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".matrixx/../secrets.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside .matrixx/")
     })

      test("should allow case-insensitive .MATRIX directory", async () => {
        // given
        setupMessageStorage(TEST_SESSION_ID, "oracle")
        const hook = createOracleMdOnlyHook(createMockPluginInput())
        const input = {
          tool: "Write",
          sessionID: TEST_SESSION_ID,
          callID: "call-1",
        }
        const output = {
          args: { filePath: ".MATRIXX/plans/work-plan.md" },
        }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow nested project path with .matrixx (Windows real-world case)", async () => {
       // given - simulates when ctx.directory is parent of actual project
       // User reported: xauusd-dxy-plan\.matrixx\drafts\supabase-email-templates.md
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "xauusd-dxy-plan\\.matrixx\\drafts\\supabase-email-templates.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow nested project path with mixed separators", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "my-project/.matrixx\\plans/task.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block nested project path without .matrixx", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "oracle")
       const hook = createOracleMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "my-project\\src\\code.ts" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files")
     })
  })
})
