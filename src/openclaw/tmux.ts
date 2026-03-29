import { spawn } from "bun"
import { getTmuxPath } from "../tools/interactive-bash/tmux-path-resolver"
import {
  getCurrentPaneId,
  getResolvedMultiplexerRuntime,
  isInsideTmux,
} from "../shared/tmux"

export async function getCurrentTmuxSession(): Promise<string | null> {
  const resolvedMultiplexer = getResolvedMultiplexerRuntime()
  if (resolvedMultiplexer && resolvedMultiplexer.paneBackend !== "tmux") {
    return null
  }

  if (!isInsideTmux(resolvedMultiplexer ?? undefined)) {
    return null
  }

  const paneId = getCurrentPaneId(resolvedMultiplexer ?? undefined)
  if (!paneId) return null

  return getTmuxSessionName()
}

export async function getTmuxSessionName(): Promise<string | null> {
  try {
    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) return null

    const proc = spawn([tmuxPath, "display-message", "-p", "#S"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const outputPromise = new Response(proc.stdout).text()
    await proc.exited
    const output = await outputPromise
    // Await proc.exited ensures exitCode is set; avoid race condition
    if (proc.exitCode !== 0) return null
    return output.trim() || null
  } catch {
    return null
  }
}

export async function captureTmuxPane(paneId: string, lines = 15): Promise<string | null> {
  try {
    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) return null

    const proc = spawn(
      [tmuxPath, "capture-pane", "-p", "-t", paneId, "-S", `-${lines}`],
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
    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) return false

    const literalProc = spawn([tmuxPath, "send-keys", "-t", paneId, "-l", "--", text], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await literalProc.exited
    if (literalProc.exitCode !== 0) return false

    if (!confirm) return true

    const enterProc = spawn([tmuxPath, "send-keys", "-t", paneId, "Enter"], {
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
  const resolvedMultiplexer = getResolvedMultiplexerRuntime()
  if (resolvedMultiplexer && resolvedMultiplexer.paneBackend !== "tmux") {
    return false
  }

  try {
    const tmuxPath = await getTmuxPath()
    if (!tmuxPath) return false

    const proc = spawn([tmuxPath, "-V"], {
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
