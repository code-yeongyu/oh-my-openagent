import { describe, test, expect } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openCodeShellTypeResolver } from "../../shared/opencode-shell"
import type { ShellType } from "../../shared/shell-env"
import { createNonInteractiveEnvHook, NON_INTERACTIVE_ENV } from "./index"

function shellDeps(shellType: ShellType) {
  return { resolveShellType: () => shellType }
}

const unixShell = shellDeps("unix")

async function prefixedGitCommand(hook: ReturnType<typeof createNonInteractiveEnvHook>, command = "git status"): Promise<string> {
  const output: { args: Record<string, unknown>; message?: string } = { args: { command } }
  await hook["tool.execute.before"]({ tool: "bash", sessionID: "test", callID: "1" }, output)
  return output.args.command as string
}

describe("non-interactive-env hook", () => {
  const mockCtx = {} as Parameters<typeof createNonInteractiveEnvHook>[0]

  describe("git command modification", () => {
    test("#given git command #when hook executes #then prepends export statement", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
      const output: { args: Record<string, unknown>; message?: string } = {
        args: {},
      }

      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output
      )

      expect(output.args.command).toBeUndefined()
    })

    test("#given git command already has prefix #when hook executes again #then does not duplicate prefix", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
      
      // First call: transforms the command
      const output1: { args: Record<string, unknown>; message?: string } = {
        args: { command: "git commit -m 'test'" },
      }
      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "1" },
        output1
      )
      
      const firstResult = output1.args.command as string
      expect(firstResult).toStartWith("export ")
      
      // Second call: takes the already-prefixed command
      const output2: { args: Record<string, unknown>; message?: string } = {
        args: { command: firstResult },
      }
      await hook["tool.execute.before"](
        { tool: "bash", sessionID: "test", callID: "2" },
        output2
      )
      
      // Should be exactly the same (no double prefix)
      expect(output2.args.command).toBe(firstResult)
    })
  })

  describe("shell escaping", () => {
    test("#given git command #when building prefix #then VISUAL properly escaped", async () => {
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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
      const hook = createNonInteractiveEnvHook(mockCtx, unixShell)
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

  describe("prefix syntax follows the shell OpenCode runs", () => {
    test("#given OpenCode runs a unix shell #when a git command executes #then the prefix uses export syntax", async () => {
      const cmd = await prefixedGitCommand(createNonInteractiveEnvHook(mockCtx, shellDeps("unix")))

      expect(cmd).toStartWith("export ")
      expect(cmd).toEndWith("; git status")
    })

    test("#given OpenCode runs PowerShell #when a git command executes #then the prefix uses $env: syntax with no cmd separators", async () => {
      const cmd = await prefixedGitCommand(createNonInteractiveEnvHook(mockCtx, shellDeps("powershell")))

      expect(cmd).toStartWith("$env:")
      expect(cmd).not.toContain("&&")
      expect(cmd).toEndWith("; git status")
    })

    test("#given OpenCode runs cmd #when a git command executes #then the prefix uses set ... && syntax", async () => {
      const cmd = await prefixedGitCommand(createNonInteractiveEnvHook(mockCtx, shellDeps("cmd")))

      expect(cmd).toStartWith("set ")
      expect(cmd).toEndWith("&& git status")
    })

    test("#given OpenCode runs csh #when a git command executes #then the prefix uses setenv syntax", async () => {
      const cmd = await prefixedGitCommand(createNonInteractiveEnvHook(mockCtx, shellDeps("csh")))

      expect(cmd).toStartWith("setenv ")
    })

    test("#given the OpenCode config names a pwsh that exists #when the default hook prefixes a git command #then it uses PowerShell syntax", async () => {
      // given: a real file named pwsh, configured the way the config handler records OpenCode's shell key
      const root = mkdtempSync(join(tmpdir(), "omo-opencode-shell-"))
      const pwsh = join(root, "pwsh")
      writeFileSync(pwsh, "")
      chmodSync(pwsh, 0o755)
      openCodeShellTypeResolver.setConfiguredShell(pwsh)
      try {
        // when
        const cmd = await prefixedGitCommand(createNonInteractiveEnvHook(mockCtx))

        // then
        expect(cmd).toStartWith("$env:")
      } finally {
        openCodeShellTypeResolver.setConfiguredShell(undefined)
        rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
