import { tool } from "@opencode-ai/plugin/tool"
import { DEFAULT_TIMEOUT_MS, INTERACTIVE_BASH_DESCRIPTION } from "./constants"

export const interactive_bash = tool({
  description: INTERACTIVE_BASH_DESCRIPTION,
  args: {
    tmux_command: tool.schema.string().describe("The tmux command to execute (without 'tmux' prefix)"),
  },
  execute: async (args) => {
    try {
      const parts = args.tmux_command.split(/\s+/).filter((p) => p.length > 0)

      if (parts.length === 0) {
        return "Error: Empty tmux command"
      }

      const proc = Bun.spawn(["tmux", ...parts], {
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

      const stdout = await Promise.race([new Response(proc.stdout).text(), timeoutPromise])
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      if (exitCode !== 0 && stderr.trim()) {
        return `Error: ${stderr.trim()}`
      }

      return stdout || "(no output)"
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})
