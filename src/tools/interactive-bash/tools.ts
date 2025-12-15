import { tool } from "@opencode-ai/plugin/tool"
import { BLOCKED_TMUX_SUBCOMMANDS, DEFAULT_TIMEOUT_MS, INTERACTIVE_BASH_DESCRIPTION } from "./constants"
import { getCachedTmuxPath } from "./utils"

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

export const interactive_bash = tool({
  description: INTERACTIVE_BASH_DESCRIPTION,
  args: {
    tmux_command: tool.schema.string().describe("The tmux command to execute (without 'tmux' prefix)"),
  },
  execute: async (args) => {
    try {
      const tmuxPath = getCachedTmuxPath() ?? "tmux"

      const parts = tokenizeCommand(args.tmux_command)

      if (parts.length === 0) {
        return "Error: Empty tmux command"
      }

      const subcommand = parts[0].toLowerCase()
      if (BLOCKED_TMUX_SUBCOMMANDS.includes(subcommand)) {
        return `Error: '${parts[0]}' is blocked. Use bash tool instead for capturing/printing terminal output.`
      }

      const proc = Bun.spawn([tmuxPath, ...parts], {
        stdout: "pipe",
        stderr: "pipe",
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        const id = setTimeout(() => {
          proc.kill()
          reject(new Error(`Timeout after ${DEFAULT_TIMEOUT_MS}ms`))
        }, DEFAULT_TIMEOUT_MS)
        proc.exited.then(() => clearTimeout(id))
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
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
