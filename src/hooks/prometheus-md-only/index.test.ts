import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createPrometheusMdOnlyHook } from "./index"
import { MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { SYSTEM_DIRECTIVE_PREFIX, createSystemDirective, SystemDirectiveTypes } from "../../shared/system-directive"
import { clearSessionAgent } from "../../features/claude-code-session-state"

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
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should allow Prometheus to write .md files inside .sisyphus/", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/tmp/test/.sisyphus/plans/work-plan.md" },
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should inject workflow reminder when Prometheus writes to .sisyphus/plans/", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.sisyphus/plans/work-plan.md" },
      }

      // #when
      await hook["tool.execute.before"](input, output)

      // #then
      expect(output.message).toContain("PROMETHEUS MANDATORY WORKFLOW REMINDER")
      expect(output.message).toContain("INTERVIEW")
      expect(output.message).toContain("METIS CONSULTATION")
      expect(output.message).toContain("MOMUS REVIEW")
    })

    test("should NOT inject workflow reminder for .sisyphus/drafts/", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.sisyphus/drafts/notes.md" },
      }

      // #when
      await hook["tool.execute.before"](input, output)

      // #then
      expect(output.message).toBeUndefined()
    })

    test("should block Prometheus from writing .md files outside .sisyphus/", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/README.md" },
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files inside .sisyphus/")
    })

    test("should block Edit tool for non-.md files", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Edit",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/code.py" },
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).rejects.toThrow("can only write/edit .md files")
    })

    test("should not affect non-Write/Edit tools", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Read",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should handle missing filePath gracefully", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: {},
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should inject read-only warning when Prometheus calls delegate_task", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "delegate_task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { prompt: "Analyze this codebase" },
      }

      // #when
      await hook["tool.execute.before"](input, output)

      // #then
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
      expect(output.args.prompt).toContain("DO NOT modify any files")
    })

    test("should inject read-only warning when Prometheus calls task", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { prompt: "Research this library" },
      }

      // #when
      await hook["tool.execute.before"](input, output)

      // #then
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
    })

    test("should inject read-only warning when Prometheus calls call_omo_agent", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "call_omo_agent",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { prompt: "Find implementation examples" },
      }

      // #when
      await hook["tool.execute.before"](input, output)

      // #then
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
    })

    test("should not double-inject warning if already present", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "delegate_task",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const promptWithWarning = `Some prompt ${SYSTEM_DIRECTIVE_PREFIX} already here`
      const output = {
        args: { prompt: promptWithWarning },
      }

      // #when
      await hook["tool.execute.before"](input, output)

      // #then
      const occurrences = (output.args.prompt as string).split(SYSTEM_DIRECTIVE_PREFIX).length - 1
      expect(occurrences).toBe(1)
    })
  })

  describe("with non-Prometheus agent in message storage", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "sisyphus")
    })

    test("should not affect non-Prometheus agents", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should not inject warning for non-Prometheus agents calling delegate_task", async () => {
      // #given
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

      // #when
      await hook["tool.execute.before"](input, output)

      // #then
      expect(output.args.prompt).toBe(originalPrompt)
      expect(output.args.prompt).not.toContain(SYSTEM_DIRECTIVE_PREFIX)
    })
  })

  describe("without message storage", () => {
    test("should handle missing session gracefully (no agent found)", async () => {
      // #given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: "non-existent-session",
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/path/to/file.ts" },
      }

      // #when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })
  })

  describe("cross-platform path validation", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "Prometheus (Planner)")
    })

     test("should allow Windows-style backslash paths under .sisyphus/", async () => {
       // #given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".sisyphus\\plans\\work-plan.md" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow mixed separator paths under .sisyphus/", async () => {
       // #given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".sisyphus\\plans/work-plan.MD" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow uppercase .MD extension", async () => {
       // #given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".sisyphus/plans/work-plan.MD" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block paths outside workspace root even if containing .sisyphus", async () => {
       // #given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "/other/project/.sisyphus/plans/x.md" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside .sisyphus/")
     })

     test("should allow nested .sisyphus directories (ctx.directory may be parent)", async () => {
       // #given - when ctx.directory is parent of actual project, path includes project name
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "src/.sisyphus/plans/x.md" },
       }

       // #when / #then - should allow because .sisyphus is in path
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block path traversal attempts", async () => {
       // #given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".sisyphus/../secrets.md" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside .sisyphus/")
     })

     test("should allow case-insensitive .SISYPHUS directory", async () => {
       // #given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: ".SISYPHUS/plans/work-plan.md" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow nested project path with .sisyphus (Windows real-world case)", async () => {
       // #given - simulates when ctx.directory is parent of actual project
       // User reported: xauusd-dxy-plan\.sisyphus\drafts\supabase-email-templates.md
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "xauusd-dxy-plan\\.sisyphus\\drafts\\supabase-email-templates.md" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow nested project path with mixed separators", async () => {
       // #given
       setupMessageStorage(TEST_SESSION_ID, "prometheus")
       const hook = createPrometheusMdOnlyHook(createMockPluginInput())
       const input = {
         tool: "Write",
         sessionID: TEST_SESSION_ID,
         callID: "call-1",
       }
       const output = {
         args: { filePath: "my-project/.sisyphus\\plans/task.md" },
       }

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block nested project path without .sisyphus", async () => {
       // #given
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

       // #when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files")
     })
  })
})
