import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, NON_INTERACTIVE_ENV, SHELL_COMMAND_PATTERNS } from "./constants"
import { log, buildEnvPrefix, replaceToolArgs } from "../../shared"
import { detectShellType, type ShellType } from "../../shared/shell-env"

export * from "./constants"
export * from "./detector"
export * from "./types"

const BANNED_COMMAND_PATTERNS = SHELL_COMMAND_PATTERNS.banned
  .filter((command) => !command.includes("("))
  .map((cmd) => new RegExp(`\\b${cmd}\\b`))

function detectBannedCommand(command: string): string | undefined {
  for (let i = 0; i < BANNED_COMMAND_PATTERNS.length; i++) {
    if (BANNED_COMMAND_PATTERNS[i].test(command)) {
      return SHELL_COMMAND_PATTERNS.banned[i]
    }
  }
  return undefined
}

function detectWindowsShellType(shellPath: string | undefined): ShellType | undefined {
  if (!shellPath) {
    return undefined
  }

  const shellName = shellPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase()
  if (shellName === "cmd" || shellName === "cmd.exe") {
    return "cmd"
  }
  if (
    shellName === "powershell" ||
    shellName === "powershell.exe" ||
    shellName === "pwsh" ||
    shellName === "pwsh.exe"
  ) {
    return "powershell"
  }
  return undefined
}

function detectCommandShellType(): ShellType {
  if (process.platform !== "win32") {
    return detectShellType()
  }

  // OpenCode on Windows runs the bash tool through a Windows shell
  // (PowerShell by default, with cmd as the user-overridable fallback),
  // regardless of MSYSTEM or a Unix-shaped SHELL value set by Git Bash.
  // Map any explicit Windows shell we can recognize; otherwise default
  // to PowerShell so the prepended env-var syntax matches the shell that
  // actually executes the command. See #3607.
  const fromShell = detectWindowsShellType(process.env.SHELL)
  if (fromShell) {
    return fromShell
  }
  if (!process.env.SHELL && !process.env.MSYSTEM) {
    const fromComSpec = detectWindowsShellType(process.env.ComSpec)
    if (fromComSpec) {
      return fromComSpec
    }
    return "cmd"
  }
  return "powershell"
}

export function createNonInteractiveEnvHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "bash") {
        return
      }

      const command = output.args.command as string | undefined
      if (!command) {
        return
      }

      const bannedCmd = detectBannedCommand(command)
      if (bannedCmd) {
        output.message = `Warning: '${bannedCmd}' is an interactive command that may hang in non-interactive environments.`
      }

      // Only prepend env vars for git commands (editor blocking, pager, etc.)
      const isGitCommand = /\bgit\b/.test(command)
      if (!isGitCommand) {
        return
      }

      // NOTE: We intentionally removed the isNonInteractive() check here.
      // Even when OpenCode runs in a TTY, the agent cannot interact with
      // spawned bash processes. Git commands like `git rebase --continue`
      // would open editors (vim/nvim) that hang forever.
      // The env vars (GIT_EDITOR=:, EDITOR=:, etc.) must ALWAYS be injected
      // for git commands to prevent interactive prompts.

      const shellType = detectCommandShellType()
      const envPrefix = buildEnvPrefix(NON_INTERACTIVE_ENV, shellType)
      
      // Check if the command already starts with the prefix to avoid stacking.
      // This maintains the non-interactive behavior and makes the operation idempotent.
      if (command.trim().startsWith(envPrefix.trim())) {
        return
      }

      replaceToolArgs(output, { command: `${envPrefix} ${command}` })

      log(`[${HOOK_NAME}] Prepended non-interactive env vars to git command`, {
        sessionID: input.sessionID,
        envPrefix,
      })
    },
  }
}
