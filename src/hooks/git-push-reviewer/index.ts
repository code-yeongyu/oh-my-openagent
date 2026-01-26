import type { PluginInput } from "@opencode-ai/plugin"

export type { GitPushReviewerConfig } from "./types"

// Git push detection (including compound commands)
const SIMPLE_GIT_PUSH = /^\s*git\s+push(\s|$)/i

function containsGitPush(command: string): boolean {
  if (SIMPLE_GIT_PUSH.test(command)) return true

  // Split compound commands (&&, ;, |)
  const tokens = command.split(/\s*(?:&&|;|\|)\s*/)
  return tokens.some((token) => SIMPLE_GIT_PUSH.test(token.trim()))
}

async function findCommand(name: string): Promise<string | null> {
  try {
    const result = await Bun.$`which ${name}`.text()
    return result.trim() || null
  } catch {
    return null
  }
}

async function sendNotification(ctx: PluginInput, title: string, message: string): Promise<void> {
  const terminalNotifier = await findCommand("terminal-notifier")
  if (terminalNotifier) {
    await ctx.$`${terminalNotifier} -title ${title} -message ${message}`.catch(() => {})
    return
  }
  const osascript = await findCommand("osascript")
  if (osascript) {
    const esTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    const esMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    await ctx
      .$`${osascript} -e ${"display notification \"" + esMessage + "\" with title \"" + esTitle + "\""}`
      .catch(() => {})
  }
}

export function createGitPushReviewerHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "bash") return

      const args = output.args as { command?: string; workdir?: string }
      if (!args?.command) return

      if (!containsGitPush(args.command)) return

      // Git push detected - start review flow
      const isInteractive = process.stdin.isTTY === true
      const zedPath = await findCommand("zed")
      const workdir = args.workdir ?? ctx.directory

      // Non-interactive environment → block
      if (!isInteractive) {
        await sendNotification(ctx, "OpenCode", "git push blocked - interactive environment required")
        args.command = 'echo "Push blocked: interactive environment required for review"'
        return
      }

      // zed not installed → block
      if (!zedPath) {
        await sendNotification(ctx, "OpenCode", "git push blocked - zed editor required")
        args.command =
          'echo "Push blocked: zed editor required for review. Install with: brew install --cask zed"'
        return
      }

      // Interactive + zed available → review flow
      await sendNotification(ctx, "OpenCode", "git push detected - please review")

      // Open zed for diff review
      try {
        await ctx.$`cd ${workdir} && ${zedPath} .`
      } catch {
        await sendNotification(ctx, "OpenCode", "git push blocked - zed failed to open")
        args.command = 'echo "Push blocked: zed failed to open for review"'
        return
      }

      // Wait for user confirmation
      const readline = await import("readline")
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })

      const confirmed = await new Promise<boolean>((resolve) => {
        rl.question("Proceed with push? (y/n): ", (answer) => {
          rl.close()
          resolve(answer.trim().toLowerCase() === "y")
        })
      })

      if (!confirmed) {
        args.command = 'echo "Push cancelled by user"'
      }
      // If confirmed, args.command remains unchanged (original git push executes)
    },
  }
}
