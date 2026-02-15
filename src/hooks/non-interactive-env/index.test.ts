import { describe, test, expect } from "bun:test"
import { createNonInteractiveEnvHook, NON_INTERACTIVE_ENV } from "./index"

describe("non-interactive-env hook", () => {
  const mockCtx = {} as Parameters<typeof createNonInteractiveEnvHook>[0]

  describe("shell.env hook", () => {
    test("#given shell.env hook #when executes #then injects all NON_INTERACTIVE_ENV vars", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { env: Record<string, string> } = { env: {} }

      await hook["shell.env"](
        { cwd: "/test" },
        output
      )

      for (const [key, value] of Object.entries(NON_INTERACTIVE_ENV)) {
        expect(output.env[key]).toBe(value)
      }
    })

    test("#given shell.env hook #when executes #then overwrites existing env vars", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { env: Record<string, string> } = { env: { CI: "false" } }

      await hook["shell.env"](
        { cwd: "/test" },
        output
      )

      expect(output.env.CI).toBe("true")
    })
  })

  describe("tool.execute.before hook - banned command detection", () => {
    test("#given vim command #when hook executes #then warning message set", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "vim file.txt" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.message).toContain("vim")
      expect(output.message).toContain("interactive")
    })

    test("#given safe command #when hook executes #then no warning", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "ls -la" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.message).toBeUndefined()
    })

    test("#given git command #when hook executes #then no modification (env via shell.env)", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git commit -m 'test'")
    })

    test("#given non-bash tool #when hook executes #then command unchanged", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "Read", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("git status")
    })

    test("#given empty command #when hook executes #then no error", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: {},
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBeUndefined()
    })
  })
})
