import { describe, test, expect } from "bun:test"
import { createNonInteractiveEnvHook, NON_INTERACTIVE_ENV } from "./index"

describe("non-interactive-env hook", () => {
  const mockCtx = {} as Parameters<typeof createNonInteractiveEnvHook>[0]

  describe("git command modification", () => {
    test("#given git command #when hook executes #then prepends env vars", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toContain("GIT_EDITOR=:")
      expect(cmd).toContain("EDITOR=:")
      expect(cmd).toContain("PAGER=cat")
      expect(cmd).toEndWith(" git commit -m 'test'")
    })

    test("#given non-git bash command #when hook executes #then command unchanged", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "ls -la" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBe("ls -la")
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

  describe("shell escaping", () => {
    test("#given git command #when building prefix #then VISUAL properly escaped", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toContain("VISUAL=''")
    })

    test("#given git command #when building prefix #then all NON_INTERACTIVE_ENV vars included", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git log" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      for (const key of Object.keys(NON_INTERACTIVE_ENV)) {
        expect(cmd).toContain(`${key}=`)
      }
    })
  })

  describe("banned command detection", () => {
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
  })
})
