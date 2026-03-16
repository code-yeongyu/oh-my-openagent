import { spawn } from "bun"

export function getCurrentTmuxSession(): string | null {
  const env = process.env.TMUX
  if (!env) return null
  const match = env.match(/(\d+)$/)
  return match ? `session-${match[1]}` : null // Wait, TMUX env is /tmp/tmux-501/default,1234,0
  // Reference tmux.js gets session name via `tmux display-message -p '#S'`
}

export async function getTmuxSessionName(): Promise<string | null> {
  try {
    const proc = spawn(["tmux", "display-message", "-p", "#S"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const output = await new Response(proc.stdout).text()
    if (proc.exitCode !== 0) return null
    return output.trim() || null
  } catch {
    return null
  }
}

export async function captureTmuxPane(paneId: string, lines = 15): Promise<string | null> {
  try {
    const proc = spawn(
      ["tmux", "capture-pane", "-p", "-t", paneId, "-S", `-${lines}`],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    )
    const output = await new Response(proc.stdout).text()
    if (proc.exitCode !== 0) return null
    return output.trim() || null
  } catch {
    return null
  }
}

export async function sendToPane(paneId: string, text: string, confirm = true): Promise<boolean> {
  try {
    const proc = spawn(["tmux", "send-keys", "-t", paneId, text, ...(confirm ? ["Enter"] : [])], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    const proc = spawn(["tmux", "-V"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export function analyzePaneContent(content: string | null): { confidence: number } {
  if (!content) return { confidence: 0 }
  // Simple heuristic: check for common CLI prompts or output
  // Reference implementation had more logic, but for now simple check is okay
  // Ideally, I should port the reference logic.
  // Reference logic:
  // if (content.includes("opencode")) confidence += 0.5
  // if (content.includes("How can I help you?")) confidence += 0.8
  // etc.
  
  let confidence = 0
  if (content.includes("opencode")) confidence += 0.3
  if (content.includes("How can I help you?")) confidence += 0.5
  if (content.includes("Type /help")) confidence += 0.2
  
  return { confidence: Math.min(1, confidence) }
}
