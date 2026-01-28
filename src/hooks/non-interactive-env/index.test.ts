import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createNonInteractiveEnvHook, NON_INTERACTIVE_ENV } from "./index"

describe("non-interactive-env hook", () => {
  const mockCtx = {} as Parameters<typeof createNonInteractiveEnvHook>[0]

  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      SHELL: process.env.SHELL,
      PSModulePath: process.env.PSModulePath,
      CI: process.env.CI,
      OPENCODE_NON_INTERACTIVE: process.env.OPENCODE_NON_INTERACTIVE,
    }
    // #given clean Unix-like environment for all tests
    // This prevents CI environments (which may have PSModulePath set) from
    // triggering PowerShell detection in tests that expect Unix behavior
    delete process.env.PSModulePath
    process.env.SHELL = "/bin/bash"
    process.env.OPENCODE_NON_INTERACTIVE = "true"
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe("git command modification", () => {
    test("#given git command #when hook executes #then prepends export statement", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain("GIT_EDITOR=:")
      expect(cmd).toContain("EDITOR=:")
      expect(cmd).toContain("PAGER=cat")
      expect(cmd).toContain("; git commit -m 'test'")
    })

    test("#given chained git commands #when hook executes #then export applies to all", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git add file && git rebase --continue" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain("; git add file && git rebase --continue")
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

  describe("bash tool always uses unix shell syntax", () => {
    // The bash tool always runs in a Unix-like shell (bash/sh), even on Windows
    // (via Git Bash, WSL, etc.), so we should always use unix export syntax.
    // This fixes GitHub issues #983 and #889.

    test("#given macOS platform #when git command executes #then uses unix export syntax", async () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/bin/zsh"
      Object.defineProperty(process, "platform", { value: "darwin" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain(";")
      expect(cmd).not.toContain("$env:")
      expect(cmd).not.toContain("set ")
    })

    test("#given Linux platform #when git command executes #then uses unix export syntax", async () => {
      delete process.env.PSModulePath
      process.env.SHELL = "/bin/bash"
      Object.defineProperty(process, "platform", { value: "linux" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain("; git commit")
    })

    test("#given Windows with PowerShell env #when bash tool git command executes #then still uses unix export syntax", async () => {
      // Even when PSModulePath is set (indicating PowerShell environment),
      // the bash tool runs in a Unix-like shell, so we use export syntax
      process.env.PSModulePath = "C:\\Program Files\\PowerShell\\Modules"
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      // Should use unix export syntax, NOT PowerShell $env: syntax
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain("; git status")
      expect(cmd).not.toContain("$env:")
      expect(cmd).not.toContain("set ")
    })

    test("#given Windows without SHELL env #when bash tool git command executes #then still uses unix export syntax", async () => {
      // Even when detectShellType() would return "cmd" (no SHELL, no PSModulePath, win32),
      // the bash tool runs in a Unix-like shell, so we use export syntax
      delete process.env.PSModulePath
      delete process.env.SHELL
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git log" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      // Should use unix export syntax, NOT cmd.exe set syntax
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain("; git log")
      expect(cmd).not.toContain("set ")
      expect(cmd).not.toContain("&&")
      expect(cmd).not.toContain("$env:")
    })

    test("#given Windows Git Bash environment #when git command executes #then uses unix export syntax", async () => {
      // Simulating Git Bash on Windows: SHELL might be set to /usr/bin/bash
      delete process.env.PSModulePath
      process.env.SHELL = "/usr/bin/bash"
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git status" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain("; git status")
    })

    test("#given any platform #when chained git commands via bash tool #then uses unix export syntax", async () => {
      // Even on Windows, chained commands should use unix syntax
      delete process.env.PSModulePath
      delete process.env.SHELL
      Object.defineProperty(process, "platform", { value: "win32" })

      const hook = createNonInteractiveEnvHook(mockCtx)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git add file && git commit -m 'test'" },
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      const cmd = output.args.command as string
      expect(cmd).toStartWith("export ")
      expect(cmd).toContain("; git add file && git commit")
    })
  })
})
