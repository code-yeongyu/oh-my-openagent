import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearSessionAgent } from "../../features/claude-code-session-state"
import { MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { createPrometheusMdOnlyHook } from "./index"

describe("prometheus-md-only", () => {
  const TEST_SESSION_ID = "test-session-prometheus"
  let testMessageDir: string

  function createMockPluginInput() {
    return {
      client: {},
      directory: "/tmp/test",
    } as never
  }

  function setupMessageStorage(sessionID: string, agent: string): void {
    testMessageDir = join(MESSAGE_STORAGE, sessionID)
    mkdirSync(testMessageDir, { recursive: true })
    const messageContent = {
      agent,
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

   describe("with Prometheus agent in message storage", () => {
     beforeEach(() => {
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
     })

    test("should block Prometheus from writing non-.md files", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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

    test("should allow Prometheus to write .md files inside changes/", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/tmp/test/changes/plans/work-plan.md" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should allow writes to changes/plans without workflow reminder injection", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/changes/plans/work-plan.md" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.message).toBeUndefined()
    })

    test("should allow writes to changes/drafts without workflow reminder injection", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/changes/drafts/notes.md" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.message).toBeUndefined()
    })

    test("should block Prometheus from writing .md files outside changes/", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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
      ).rejects.toThrow("can only write/edit .md files inside changes/ directory")
    })

    test("should block Edit tool for non-.md files", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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

    test("should allow bash commands from Prometheus", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "bash",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { command: "touch file.md" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should not affect non-blocked tools", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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

    test("should inject read-only warning when Prometheus calls delegate_task", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "delegate_task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { prompt: "Analyze this codebase" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.args.prompt).toContain("PROMETHEUS READ-ONLY")
      expect(output.args.prompt).toContain("DO NOT modify any files")
    })

    test("should inject read-only warning when Prometheus calls task", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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
      expect(output.args.prompt).toContain("PROMETHEUS READ-ONLY")
    })

    test("should inject read-only warning when Prometheus calls call_omo_agent", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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
      expect(output.args.prompt).toContain("PROMETHEUS READ-ONLY")
    })

    test("should not double-inject warning if already present", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "delegate_task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const promptWithWarning = "Some prompt [SYSTEM DIRECTIVE: OH-MY-OPENCODE - PROMETHEUS READ-ONLY] already here"
      const output = {
        args: { prompt: promptWithWarning },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      const occurrences = (output.args.prompt as string).split("PROMETHEUS READ-ONLY").length - 1
      expect(occurrences).toBe(1)
    })
  })

  describe("with non-Prometheus agent in message storage", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "sisyphus")
    })

    test("should not affect non-Prometheus agents", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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

    test("should not inject warning for non-Prometheus agents calling delegate_task", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "delegate_task",
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
      expect(output.args.prompt).not.toContain("PROMETHEUS READ-ONLY")
    })
  })

  describe("boulder state priority over message files (fixes #927)", () => {
    const BOULDER_DIR = join(tmpdir(), `boulder-test-${randomUUID()}`)
    const BOULDER_FILE = join(BOULDER_DIR, ".sisyphus", "boulder.json")

    beforeEach(() => {
      mkdirSync(join(BOULDER_DIR, ".sisyphus"), { recursive: true })
    })

    afterEach(() => {
      rmSync(BOULDER_DIR, { recursive: true, force: true })
    })

    //#given session was started with prometheus (first message), but /start-work set boulder agent to atlas
    //#when user types "continue" after interruption (memory cleared, falls back to message files)
    //#then should use boulder state agent (atlas), not message file agent (prometheus)
    test("should prioritize boulder agent over message file agent", async () => {
      // given - prometheus in message files (from /plan)
      setupMessageStorage(TEST_SESSION_ID, "prometheus")
      
      // given - atlas in boulder state (from /start-work)
      writeFileSync(BOULDER_FILE, JSON.stringify({
        active_plan: "/test/plan.md",
        started_at: new Date().toISOString(),
        session_ids: [TEST_SESSION_ID],
        plan_name: "test-plan",
        agent: "atlas"
      }))

      const hook = createPrometheusMdOnlyHook({
        client: {},
        directory: BOULDER_DIR,
      } as never)

      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.ts" },
      }

      // when / then - should NOT block because boulder says atlas, not prometheus
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should use prometheus from boulder state when set", async () => {
      // given - atlas in message files (from some other agent)
      setupMessageStorage(TEST_SESSION_ID, "atlas")
      
      // given - prometheus in boulder state (edge case, but should honor it)
      writeFileSync(BOULDER_FILE, JSON.stringify({
        active_plan: "/test/plan.md",
        started_at: new Date().toISOString(),
        session_ids: [TEST_SESSION_ID],
        plan_name: "test-plan",
        agent: "prometheus"
      }))

      const hook = createPrometheusMdOnlyHook({
        client: {},
        directory: BOULDER_DIR,
      } as never)

      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.ts" },
      }

      // when / then - should block because boulder says prometheus
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should fall back to message files when session not in boulder", async () => {
      // given - prometheus in message files
      setupMessageStorage(TEST_SESSION_ID, "prometheus")
      
      // given - boulder state exists but for different session
      writeFileSync(BOULDER_FILE, JSON.stringify({
        active_plan: "/test/plan.md",
        started_at: new Date().toISOString(),
        session_ids: ["other-session-id"],
        plan_name: "test-plan",
        agent: "atlas"
      }))

      const hook = createPrometheusMdOnlyHook({
        client: {},
        directory: BOULDER_DIR,
      } as never)

      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.ts" },
      }

      // when / then - should block because falls back to message files (prometheus)
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })
  })

  describe("without message storage", () => {
    test("should handle missing session gracefully (no agent found)", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: "non-existent-session",
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
      setupMessageStorage(TEST_SESSION_ID, "prometheus")
    })

     test("should allow Windows-style backslash paths under changes/", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "changes\\plans\\work-plan.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow mixed separator paths under changes/", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "changes\\plans/work-plan.MD" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow uppercase .MD extension", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
      const output = {
         args: { filePath: "changes/plans/work-plan.MD" },
      }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block paths outside workspace root even if containing changes/", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "/other/project/changes/plans/x.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside changes/ directory")
     })

     test("should block nested changes directories when not at workspace root", async () => {
       // given - when ctx.directory is parent of actual project, nested path should be rejected
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "src/changes/plans/x.md" },
       }

       // when / #then - should block because path must start at workspace-root changes/
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside changes/ directory")
     })

     test("should block path traversal attempts", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "changes/../secrets.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside changes/ directory")
     })

     test("should allow case-insensitive CHANGES directory", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "CHANGES/plans/work-plan.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block nested project path with changes (Windows real-world case)", async () => {
       // given - simulates when ctx.directory is parent of actual project
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "xauusd-dxy-plan\\changes\\drafts\\supabase-email-templates.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside changes/ directory")
     })

     test("should block nested project path with mixed separators", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "my-project/changes\\plans/task.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside changes/ directory")
     })

     test("should block nested project path without .sisyphus", async () => {
       // given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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
