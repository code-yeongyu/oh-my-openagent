import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { clearSessionAgent } from "../../features/claude-code-session-state"

const TEST_STORAGE_ROOT = join(tmpdir(), `prometheus-md-only-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")
const TEST_PART_STORAGE = join(TEST_STORAGE_ROOT, "part")

mock.module("../../features/hook-message-injector/constants", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
}))

const { createPrometheusMdOnlyHook } = await import("./index")
const { MESSAGE_STORAGE } = await import("../../features/hook-message-injector")

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
    rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true })
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

    test("should allow Prometheus to write .md files inside .sisyphus/", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output = {
        args: { filePath: "/tmp/test/.sisyphus/plans/work-plan.md" },
      }

      // when / #then
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should inject workflow reminder when Prometheus writes to .sisyphus/plans/", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.sisyphus/plans/work-plan.md" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.message).toContain("PROMETHEUS MANDATORY WORKFLOW REMINDER")
      expect(output.message).toContain("INTERVIEW")
      expect(output.message).toContain("METIS CONSULTATION")
      expect(output.message).toContain("MOMUS REVIEW")
    })

    test("should NOT inject workflow reminder for .sisyphus/drafts/", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.sisyphus/drafts/notes.md" },
      }

      // when
      await hook["tool.execute.before"](input, output)

      // then
      expect(output.message).toBeUndefined()
    })

    test("should block Prometheus from writing .md files outside .sisyphus/", async () => {
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
      ).rejects.toThrow("can only write/edit .md files inside .sisyphus/")
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

    test("should block bash commands from Prometheus", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
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
      ).rejects.toThrow("cannot execute bash commands")
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
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
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
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
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
      expect(output.args.prompt).toContain(SYSTEM_DIRECTIVE_PREFIX)
    })

    test("should not double-inject warning if already present", async () => {
      // given
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

      // when
      await hook["tool.execute.before"](input, output)

      // then
      const occurrences = (output.args.prompt as string).split(SYSTEM_DIRECTIVE_PREFIX).length - 1
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
      expect(output.args.prompt).not.toContain(SYSTEM_DIRECTIVE_PREFIX)
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

     test("should allow Windows-style backslash paths under .sisyphus/", async () => {
       // given
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

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow mixed separator paths under .sisyphus/", async () => {
       // given
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
         args: { filePath: ".sisyphus/plans/work-plan.MD" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should block paths outside workspace root even if containing .sisyphus", async () => {
       // given
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

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside .sisyphus/")
     })

     test("should allow nested .sisyphus directories (ctx.directory may be parent)", async () => {
       // given - when ctx.directory is parent of actual project, path includes project name
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

       // when / #then - should allow because .sisyphus is in path
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
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
         args: { filePath: ".sisyphus/../secrets.md" },
       }

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).rejects.toThrow("can only write/edit .md files inside .sisyphus/")
     })

     test("should allow case-insensitive .SISYPHUS directory", async () => {
       // given
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

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow nested project path with .sisyphus (Windows real-world case)", async () => {
       // given - simulates when ctx.directory is parent of actual project
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

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
     })

     test("should allow nested project path with mixed separators", async () => {
       // given
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

       // when / #then
       await expect(
         hook["tool.execute.before"](input, output)
       ).resolves.toBeUndefined()
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

  describe("plan file overwrite protection", () => {
    beforeEach(() => {
      setupMessageStorage(TEST_SESSION_ID, "prometheus")
    })

    test("should allow first Write to a plan file", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const input = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.sisyphus/plans/my-plan.md" },
      }

      // when / #then - first write should succeed
      await expect(
        hook["tool.execute.before"](input, output)
      ).resolves.toBeUndefined()
    })

    test("should block second Write to same plan file and suggest Edit", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const planPath = "/tmp/test/.sisyphus/plans/my-plan.md"

      // first write
      const firstInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const firstOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: planPath },
      }
      await hook["tool.execute.before"](firstInput, firstOutput)

      // second write to same file
      const secondInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-2",
      }
      const secondOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: planPath },
      }

      // when / #then - second write should be blocked
      await expect(
        hook["tool.execute.before"](secondInput, secondOutput)
      ).rejects.toThrow("use Edit tool to append")
    })

    test("should allow Write to different plan files", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())

      // first write to plan-a
      const firstInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const firstOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.sisyphus/plans/plan-a.md" },
      }
      await hook["tool.execute.before"](firstInput, firstOutput)

      // second write to different file plan-b
      const secondInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-2",
      }
      const secondOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: "/tmp/test/.sisyphus/plans/plan-b.md" },
      }

      // when / #then - write to different file should succeed
      await expect(
        hook["tool.execute.before"](secondInput, secondOutput)
      ).resolves.toBeUndefined()
    })

    test("should allow Edit after Write to same plan file", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const planPath = "/tmp/test/.sisyphus/plans/my-plan.md"

      // first write
      const writeInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const writeOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: planPath },
      }
      await hook["tool.execute.before"](writeInput, writeOutput)

      // Edit to same file should be allowed
      const editInput = {
        tool: "Edit",
        sessionID: TEST_SESSION_ID,
        callID: "call-2",
      }
      const editOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: planPath },
      }

      // when / #then - Edit should succeed
      await expect(
        hook["tool.execute.before"](editInput, editOutput)
      ).resolves.toBeUndefined()
    })

    test("should track writes per session (different sessions are independent)", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const planPath = "/tmp/test/.sisyphus/plans/my-plan.md"
      const otherSessionID = "other-session-prometheus"

      // Setup second session
      const otherMessageDir = join(MESSAGE_STORAGE, otherSessionID)
      mkdirSync(otherMessageDir, { recursive: true })
      writeFileSync(
        join(otherMessageDir, "msg_001.json"),
        JSON.stringify({ agent: "prometheus", model: { providerID: "test", modelID: "test-model" } })
      )

      // first session writes to plan
      const firstSessionInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const firstSessionOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: planPath },
      }
      await hook["tool.execute.before"](firstSessionInput, firstSessionOutput)

      // second session writes to same plan path (should succeed - different session)
      const secondSessionInput = {
        tool: "Write",
        sessionID: otherSessionID,
        callID: "call-2",
      }
      const secondSessionOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: planPath },
      }

      // when / #then - different session should be allowed
      await expect(
        hook["tool.execute.before"](secondSessionInput, secondSessionOutput)
      ).resolves.toBeUndefined()

      // cleanup
      rmSync(otherMessageDir, { recursive: true, force: true })
    })

    test("should NOT apply overwrite protection to draft files", async () => {
      // given
      const hook = createPrometheusMdOnlyHook(createMockPluginInput())
      const draftPath = "/tmp/test/.sisyphus/drafts/notes.md"

      // first write to draft
      const firstInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-1",
      }
      const firstOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: draftPath },
      }
      await hook["tool.execute.before"](firstInput, firstOutput)

      // second write to same draft should succeed (drafts are working memory)
      const secondInput = {
        tool: "Write",
        sessionID: TEST_SESSION_ID,
        callID: "call-2",
      }
      const secondOutput: { args: Record<string, unknown>; message?: string } = {
        args: { filePath: draftPath },
      }

      // when / #then - multiple writes to drafts should be allowed
      await expect(
        hook["tool.execute.before"](secondInput, secondOutput)
      ).resolves.toBeUndefined()
    })
  })
})
