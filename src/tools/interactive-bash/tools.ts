import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { spawnWithWindowsHide } from "../../shared/spawn-with-windows-hide"
import { isCmuxCompatEnvironment } from "../../shared/tmux/cmux-detect"
import {
  BLOCKED_TMUX_SUBCOMMANDS,
  DEFAULT_TIMEOUT_MS,
  INTERACTIVE_BASH_DESCRIPTION,
  PROHIBITED_TMUX_SUBCOMMANDS,
} from "./constants"
import { getCachedTmuxPath } from "./tmux-path-resolver"

const GLOBAL_TMUX_OPTIONS_WITH_ARGS = new Set(["-L", "-S", "-f", "-c", "-T"])

function ignoreInteractiveBashKillError(error: unknown): void {
  if (error instanceof Error) return
  throw error
}

function resolveTmuxExecutable(tmuxPath: string): string[] {
  if (!isCmuxCompatEnvironment()) {
    return [tmuxPath]
  }

  const executableName = tmuxPath.split(/[\\/]/).pop()
  const cmuxExecutable = executableName === "cmux" ? tmuxPath : "cmux"
  return [cmuxExecutable, "__tmux-compat"]
}

/**
 * Quote-aware command tokenizer with escape handling
 * Handles single/double quotes and backslash escapes without external dependencies
 */
export function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote = false
  let quoteChar = ""
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    if ((char === "'" || char === '"') && !inQuote) {
      inQuote = true
      quoteChar = char
    } else if (char === quoteChar && inQuote) {
      inQuote = false
      quoteChar = ""
    } else if (char === " " && !inQuote) {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += char
    }
  }

  if (current) tokens.push(current)
  return tokens
}

function findSubcommandIndex(parts: string[]): number {
  let index = 0
  while (index < parts.length) {
    const part = parts[index] ?? ""

    if (part === "--") {
      return index + 1 < parts.length ? index + 1 : -1
    }

    if (GLOBAL_TMUX_OPTIONS_WITH_ARGS.has(part)) {
      index += 2
      continue
    }

    if (part.startsWith("-")) {
      index++
      continue
    }

    return index
  }

  return -1
}

function getTargetSessionName(parts: string[]): string {
  const sessionIdx = parts.findIndex(p => p === "-t" || p.startsWith("-t"))
  if (sessionIdx === -1) {
    return "omo-session"
  }

  const sessionToken = parts[sessionIdx] ?? ""
  const nextToken = parts[sessionIdx + 1]
  if (sessionToken === "-t" && nextToken) {
    return nextToken
  }

  if (sessionToken.startsWith("-t")) {
    return sessionToken.slice(2)
  }

  return "omo-session"
}

function buildBlockedTmuxCommandMessage(command: string, parts: string[]): string {
  const sessionName = getTargetSessionName(parts)

  return `Error: '${command}' is blocked in interactive_bash.

**USE BASH TOOL INSTEAD:**

\`\`\`bash
# Capture terminal output
tmux capture-pane -p -t ${sessionName}

# Or capture with history (last 1000 lines)
tmux capture-pane -p -t ${sessionName} -S -1000
\`\`\`

The Bash tool can execute these commands directly. Do NOT retry with interactive_bash.`
}

function buildProhibitedTmuxCommandMessage(command: string): string {
  return `Error: '${command}' is prohibited in interactive_bash.

NEVER EVER run tmux kill-server from interactive_bash.

It terminates the entire tmux server, destroying every tmux session and pane that the user, Codex, or other agents may be using.

Use scoped cleanup only:

\`\`\`bash
tmux kill-session -t <session-name>
\`\`\`

If you created an omo-* session, kill only that exact session. Do not retry kill-server with Bash or any other tool.`
}

type InteractiveBashArgs = {
  tmux_command: string
}

export async function executeInteractiveBash(args: InteractiveBashArgs): Promise<string> {
  try {
    const tmuxPath = getCachedTmuxPath() ?? "tmux"

    const parts = tokenizeCommand(args.tmux_command)

    if (parts.length === 0) {
      return "Error: Empty tmux command"
    }

    const subcommandIndex = findSubcommandIndex(parts)
    const rawSubcommand = subcommandIndex === -1 ? "" : parts[subcommandIndex]
    const subcommand = rawSubcommand.toLowerCase()

    if (PROHIBITED_TMUX_SUBCOMMANDS.includes(subcommand)) {
      return buildProhibitedTmuxCommandMessage(rawSubcommand)
    }

    if (BLOCKED_TMUX_SUBCOMMANDS.includes(subcommand)) {
      return buildBlockedTmuxCommandMessage(rawSubcommand, parts)
    }

    const proc = spawnWithWindowsHide([...resolveTmuxExecutable(tmuxPath), ...parts], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(() => {
        const timeoutError = new Error(`Timeout after ${DEFAULT_TIMEOUT_MS}ms`)
        try {
          proc.kill()
          // Fire-and-forget: wait for process exit in background to avoid zombies
          void proc.exited.catch((error) => {
            ignoreInteractiveBashKillError(error)
          })
        } catch (error) {
          if (!(error instanceof Error)) throw error
          // Ignore kill errors; we'll still reject with timeoutError below
        }
        reject(timeoutError)
      }, DEFAULT_TIMEOUT_MS)
      proc.exited
        .then(() => clearTimeout(id))
        .catch(() => clearTimeout(id))
    })

    // Read stdout and stderr in parallel to avoid race conditions
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      timeoutPromise,
    ])

    // Check exitCode properly - return error even if stderr is empty
    if (exitCode !== 0) {
      const errorMsg = stderr.trim() || `Command failed with exit code ${exitCode}`
      return `Error: ${errorMsg}`
    }

    return stdout || "(no output)"
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error: ${message}`
  }
}

export const interactive_bash: ToolDefinition = tool({
  description: INTERACTIVE_BASH_DESCRIPTION,
  args: {
    tmux_command: tool.schema.string().describe("The tmux command to execute (without 'tmux' prefix)"),
  },
  execute: executeInteractiveBash,
})
