import { spawn } from "bun"

export function getCurrentTmuxSession(): string | null {
  const env = process.env.TMUX
  if (!env) return null
  const match = env.match(/(\d+)$/)
  return match ? `session-${match[1]}` : null
}

export async function getTmuxSessionName(): Promise<string | null> {
  try {
    const proc = spawn(["tmux", "display-message", "-p", "#S"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const outputPromise = new Response(proc.stdout).text()
    await proc.exited
    const output = await outputPromise
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
    const outputPromise = new Response(proc.stdout).text()
    await proc.exited
    const output = await outputPromise
    if (proc.exitCode !== 0) return null
    return output.trim() || null
  } catch {
    return null
  }
}

export async function sendToPane(paneId: string, text: string, confirm = true): Promise<boolean> {
  try {
    const literalProc = spawn(["tmux", "send-keys", "-t", paneId, "-l", "--", text], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await literalProc.exited
    if (literalProc.exitCode !== 0) return false

    if (!confirm) return true

    const enterProc = spawn(["tmux", "send-keys", "-t", paneId, "Enter"], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await enterProc.exited
    return enterProc.exitCode === 0
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

  let confidence = 0
  if (content.includes("opencode")) confidence += 0.3
  if (content.includes("Ask anything...")) confidence += 0.5
  if (content.includes("Run /help")) confidence += 0.2

  return { confidence: Math.min(1, confidence) }
}
