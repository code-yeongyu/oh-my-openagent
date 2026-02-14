const { describe, expect, test } = require("bun:test")
const { createToolExecuteBeforeHandler } = require("./tool-execute-before")
const { join } = require("node:path")
const { tmpdir } = require("node:os")
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs")

describe("createToolExecuteBeforeHandler", () => {
  test("does not execute subagent question blocker hook for question tool", async () => {
    //#given
    const ctx = {
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }

    const hooks = {
      subagentQuestionBlocker: {
        "tool.execute.before": async () => {
          throw new Error("subagentQuestionBlocker should not run")
        },
      },
    }

    const handler = createToolExecuteBeforeHandler({ ctx, hooks })
    const input = { tool: "question", sessionID: "ses_sub", callID: "call_1" }
    const output = { args: { questions: [] } as Record<string, unknown> }

    //#when
    const run = handler(input, output)

    //#then
    await expect(run).resolves.toBeUndefined()
  })

  describe("task tool subagent_type normalization", () => {
    const emptyHooks = {}

    function createCtxWithSessionMessages(messages: Array<{ info?: { agent?: string; role?: string } }> = []) {
      return {
        client: {
          session: {
            messages: async () => ({ data: messages }),
          },
        },
      }
    }

    test("sets subagent_type to sisyphus-junior when category is provided without subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { category: "quick", description: "Test" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("sisyphus-junior")
    })

    test("preserves existing subagent_type when explicitly provided", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { subagent_type: "plan", description: "Plan test" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("plan")
    })

    test("sets subagent_type to sisyphus-junior when category provided with different subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { category: "quick", subagent_type: "oracle", description: "Test" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("sisyphus-junior")
    })

    test("resolves subagent_type from session first message when session_id provided without subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages([
        { info: { role: "user" } },
        { info: { role: "assistant", agent: "explore" } },
        { info: { role: "assistant", agent: "oracle" } },
      ])
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { session_id: "ses_abc123", description: "Continue task", prompt: "fix it" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("explore")
    })

    test("falls back to 'continue' when session has no agent info", async () => {
      //#given
      const ctx = createCtxWithSessionMessages([
        { info: { role: "user" } },
        { info: { role: "assistant" } },
      ])
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { session_id: "ses_abc123", description: "Continue task", prompt: "fix it" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("continue")
    })

    test("preserves subagent_type when session_id is provided with explicit subagent_type", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { session_id: "ses_abc123", subagent_type: "explore", description: "Continue explore" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("explore")
    })

    test("does not modify args for non-task tools", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "bash", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { command: "ls" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBeUndefined()
    })

    test("does not set subagent_type when neither category nor session_id is provided and subagent_type is present", async () => {
      //#given
      const ctx = createCtxWithSessionMessages()
      const handler = createToolExecuteBeforeHandler({ ctx, hooks: emptyHooks })
      const input = { tool: "task", sessionID: "ses_123", callID: "call_1" }
      const output = { args: { subagent_type: "oracle", description: "Oracle task" } as Record<string, unknown> }

      //#when
      await handler(input, output)

      //#then
      expect(output.args.subagent_type).toBe("oracle")
    })
  })

  describe("audit-loop command + Supabase guard", () => {
    function createCtx() {
      const directory = join(tmpdir(), `omo-audit-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      mkdirSync(directory, { recursive: true })
      return {
        directory,
        client: {
          session: {
            messages: async () => ({ data: [] }),
          },
        },
      }
    }

    test("starts audit-loop with parsed args from slashcommand and forces nonstop mode", async () => {
      //#given
      const started: Array<{
        sessionID: string
        prompt: string
        options: Record<string, unknown>
      }> = []

      const hooks = {
        ralphLoop: {
          startLoop: (sessionID: string, prompt: string, options: Record<string, unknown>) => {
            started.push({ sessionID, prompt, options })
            return true
          },
          getState: () => null,
        },
      }

      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when
      await handler(
        { tool: "slashcommand", sessionID: "ses_audit_1", callID: "call_1" },
        {
          args: {
            command:
              '/audit-loop "Deep UI audit" --max-duration=2h --completion-promise=done --max-iterations=12',
          } as Record<string, unknown>,
        },
      )

      //#then
      expect(started).toHaveLength(1)
      expect(started[0]).toEqual({
        sessionID: "ses_audit_1",
        prompt: "Deep UI audit",
        options: {
          mode: "audit-loop",
          ultrawork: true,
          maxIterations: 12,
          completionPromise: "done",
          completionDetectionEnabled: false,
          maxDurationMs: 7_200_000,
        },
      })
    })

    test("audit-loop without explicit completion promise remains nonstop", async () => {
      //#given
      const started: Array<{
        sessionID: string
        prompt: string
        options: Record<string, unknown>
      }> = []

      const hooks = {
        ralphLoop: {
          startLoop: (sessionID: string, prompt: string, options: Record<string, unknown>) => {
            started.push({ sessionID, prompt, options })
            return true
          },
          getState: () => null,
        },
      }

      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when
      await handler(
        { tool: "slashcommand", sessionID: "ses_audit_implicit", callID: "call_1" },
        {
          args: { command: '/audit-loop "Deep UI audit" --max-duration=3h' } as Record<string, unknown>,
        },
      )

      //#then
      expect(started).toHaveLength(1)
      expect(started[0].options.completionDetectionEnabled).toBe(false)
      expect(started[0].options.maxDurationMs).toBe(3 * 60 * 60 * 1000)
      expect(started[0].options.maxIterations).toBe(100)
    })

    test("blocks supabase db mutation command during active audit-loop", async () => {
      //#given
      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop" }),
        },
      }

      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when
      const run = handler(
        { tool: "bash", sessionID: "ses_audit_2", callID: "call_1" },
        { args: { command: "supabase db push" } as Record<string, unknown> },
      )

      //#then
      await expect(run).rejects.toThrow(
        "Supabase DB mutation is blocked while /audit-loop is active",
      )
    })

    test("allows non-db supabase mentions with explicit negation in task prompt", async () => {
      //#given
      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop" }),
        },
      }

      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when
      const run = handler(
        { tool: "task", sessionID: "ses_audit_3", callID: "call_1" },
        {
          args: {
            description: "UI polish pass",
            prompt: "Do not modify supabase database schema. Focus on frontend visual hierarchy.",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).resolves.toBeUndefined()
    })

    test("blocks writing to supabase migration sql path during active audit-loop", async () => {
      //#given
      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop" }),
        },
      }

      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when
      const run = handler(
        { tool: "write", sessionID: "ses_audit_4", callID: "call_1" },
        {
          args: {
            filePath: "apps/web/supabase/migrations/202602140001_init.sql",
            content: "-- sql",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).rejects.toThrow(
        "Supabase DB mutation is blocked while /audit-loop is active",
      )
    })

    test("enforces focus lock and blocks cross-path edits without blocker report", async () => {
      //#given
      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop", session_id: "ses_focus_1" }),
        },
      }
      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when - first write initializes focus
      await handler(
        { tool: "write", sessionID: "ses_focus_1", callID: "call_1" },
        {
          args: {
            filePath: "lib/screens/settings/settings_screen.dart",
            content: "class A {}",
          } as Record<string, unknown>,
        },
      )

      const run = handler(
        { tool: "write", sessionID: "ses_focus_1", callID: "call_2" },
        {
          args: {
            filePath: "lib/screens/dashboard/dashboard_screen.dart",
            content: "class B {}",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).rejects.toThrow("Focus lock violation")
    })

    test("allows one focus switch after blocker report task", async () => {
      //#given
      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop", session_id: "ses_focus_2" }),
        },
      }
      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      await handler(
        { tool: "write", sessionID: "ses_focus_2", callID: "call_1" },
        {
          args: {
            filePath: "lib/screens/settings/settings_screen.dart",
            content: "class A {}",
          } as Record<string, unknown>,
        },
      )

      //#when - blocker report approved then switch edit
      await handler(
        { tool: "task", sessionID: "ses_focus_2", callID: "call_2" },
        {
          args: {
            description: "BLOCKER REPORT",
            prompt:
              "BLOCKER REPORT: cannot proceed. switch focus to dashboard due to build blocker in settings.",
          } as Record<string, unknown>,
        },
      )

      const run = handler(
        { tool: "write", sessionID: "ses_focus_2", callID: "call_3" },
        {
          args: {
            filePath: "lib/screens/dashboard/dashboard_screen.dart",
            content: "class B {}",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).resolves.toBeUndefined()
    })

    test("allows one automatic focus switch when checkpoint enables screen-complete progression", async () => {
      //#given
      const ctx = createCtx()
      const checkpointPath = join(ctx.directory, ".sisyphus", "audit-loop-checkpoint.json")
      mkdirSync(join(ctx.directory, ".sisyphus"), { recursive: true })
      writeFileSync(
        checkpointPath,
        JSON.stringify({
          version: 1,
          updated_at: new Date().toISOString(),
          locked_files: [],
          recent_cycles: [],
          consecutive_validation_failures: 0,
          allow_focus_progression_once: true,
        }),
      )

      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop", session_id: "ses_focus_auto_1" }),
        },
      }
      const handler = createToolExecuteBeforeHandler({ ctx, hooks })

      await handler(
        { tool: "write", sessionID: "ses_focus_auto_1", callID: "call_1" },
        {
          args: {
            filePath: "lib/screens/settings/settings_screen.dart",
            content: "class A {}",
          } as Record<string, unknown>,
        },
      )

      //#when - first cross-path switch should be allowed by checkpoint auto progression
      const firstSwitch = handler(
        { tool: "write", sessionID: "ses_focus_auto_1", callID: "call_2" },
        {
          args: {
            filePath: "lib/screens/dashboard/dashboard_screen.dart",
            content: "class B {}",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(firstSwitch).resolves.toBeUndefined()

      const checkpointAfterSwitch = JSON.parse(readFileSync(checkpointPath, "utf-8"))
      expect(checkpointAfterSwitch.allow_focus_progression_once).toBe(false)

      //#when - second cross-path switch should be blocked (one-time allowance consumed)
      const secondSwitch = handler(
        { tool: "write", sessionID: "ses_focus_auto_1", callID: "call_3" },
        {
          args: {
            filePath: "lib/screens/profile/profile_screen.dart",
            content: "class C {}",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(secondSwitch).rejects.toThrow("Focus lock violation")
    })

    test("blocks hardcoded visual literals in audit-loop writes", async () => {
      //#given
      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop", session_id: "ses_token_1" }),
        },
      }
      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when
      const run = handler(
        { tool: "write", sessionID: "ses_token_1", callID: "call_1" },
        {
          args: {
            filePath: "lib/screens/settings/settings_screen.dart",
            content: "Container(color: Color(0xFFFFFFFF), padding: EdgeInsets.all(12))",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).rejects.toThrow("Hardcoded visual style values are blocked")
    })

    test("allows token-based visual styling in audit-loop writes", async () => {
      //#given
      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop", session_id: "ses_token_2" }),
        },
      }
      const handler = createToolExecuteBeforeHandler({ ctx: createCtx(), hooks })

      //#when
      const run = handler(
        { tool: "write", sessionID: "ses_token_2", callID: "call_1" },
        {
          args: {
            filePath: "lib/screens/settings/settings_screen.dart",
            content: "Container(color: Theme.of(context).colorScheme.surface)",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).resolves.toBeUndefined()
    })

    test("blocks edits to frozen files unless bug evidence is provided", async () => {
      //#given
      const ctx = createCtx()
      const checkpointPath = join(ctx.directory, ".sisyphus", "audit-loop-checkpoint.json")
      mkdirSync(join(ctx.directory, ".sisyphus"), { recursive: true })
      writeFileSync(
        checkpointPath,
        JSON.stringify({
          version: 1,
          updated_at: new Date().toISOString(),
          locked_files: ["lib/screens/settings/settings_screen.dart"],
          recent_cycles: [],
          consecutive_validation_failures: 0,
        }),
      )

      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop", session_id: "ses_lock_1" }),
        },
      }
      const handler = createToolExecuteBeforeHandler({ ctx, hooks })

      //#when
      const run = handler(
        { tool: "write", sessionID: "ses_lock_1", callID: "call_1" },
        {
          args: {
            filePath: "lib/screens/settings/settings_screen.dart",
            content: "class Locked {}",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).rejects.toThrow("File is locked after saturation")
    })

    test("allows one locked-file edit after bug evidence task", async () => {
      //#given
      const ctx = createCtx()
      const checkpointPath = join(ctx.directory, ".sisyphus", "audit-loop-checkpoint.json")
      mkdirSync(join(ctx.directory, ".sisyphus"), { recursive: true })
      writeFileSync(
        checkpointPath,
        JSON.stringify({
          version: 1,
          updated_at: new Date().toISOString(),
          locked_files: ["lib/screens/settings/settings_screen.dart"],
          recent_cycles: [],
          consecutive_validation_failures: 0,
        }),
      )

      const hooks = {
        ralphLoop: {
          getState: () => ({ active: true, mode: "audit-loop", session_id: "ses_lock_2" }),
        },
      }
      const handler = createToolExecuteBeforeHandler({ ctx, hooks })

      await handler(
        { tool: "task", sessionID: "ses_lock_2", callID: "call_bug" },
        {
          args: {
            description: "BUG EVIDENCE",
            prompt: "BUG EVIDENCE: keyboard trap regression found in locked file.",
          } as Record<string, unknown>,
        },
      )

      //#when
      const run = handler(
        { tool: "write", sessionID: "ses_lock_2", callID: "call_1" },
        {
          args: {
            filePath: "lib/screens/settings/settings_screen.dart",
            content: "class UnlockedOnce {}",
          } as Record<string, unknown>,
        },
      )

      //#then
      await expect(run).resolves.toBeUndefined()
    })
  })
})

export {}
