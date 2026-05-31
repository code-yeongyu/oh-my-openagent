import { runTmuxCommand } from "../shared/tmux/runner"
import { getTmuxPath } from "../tools/interactive-bash/tmux-path-resolver"

async function runOpenClawTmuxCommand(args: string[]) {
  const tmuxPath = await getTmuxPath()
  if (!tmuxPath) {
    return null
  }

  return runTmuxCommand(tmuxPath, args)
}

export function getCurrentTmuxSession(): string | null {
  const env = process.env.TMUX
  if (!env) return null
  const match = env.match(/(\d+)$/)
  return match ? `session-${match[1]}` : null
}

export async function getTmuxSessionName(): Promise<string | null> {
  try {
    const result = await runOpenClawTmuxCommand(["display-message", "-p", "#S"])
    if (!result?.success) return null
    return result.output.trim() || null
  } catch {
    return null
  }
}

export async function captureTmuxPane(paneId: string, lines = 15): Promise<string | null> {
  try {
    const result = await runOpenClawTmuxCommand(["capture-pane", "-p", "-t", paneId, "-S", `-${lines}`])
    if (!result?.success) return null
    return result.output.trim() || null
  } catch {
    return null
  }
}

export async function sendToPane(paneId: string, text: string, confirm = true): Promise<boolean> {
  try {
    const literalResult = await runOpenClawTmuxCommand(["send-keys", "-t", paneId, "-l", "--", text])
    if (!literalResult?.success) return false

    if (!confirm) return true

    const enterResult = await runOpenClawTmuxCommand(["send-keys", "-t", paneId, "Enter"])
    return enterResult?.success ?? false
  } catch {
    return false
  }
}

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    const result = await runOpenClawTmuxCommand(["-V"])
    return result?.success ?? false
  } catch {
    return false
  }
}

export function analyzePaneContent(content: string | null): { confidence: number } {
  if (!content) return { confidence: 0 }

  let confidence = 0
  if (content.includes("opencode")) confidence += 0.3
  if (content.includes("Ask anything...")) confidence += 0.5
  if (content.includes("Run /help")) confidence += 0.2

  return { confidence: Math.min(1, confidence) }
}
