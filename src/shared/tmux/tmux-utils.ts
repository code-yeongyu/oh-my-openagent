import { spawn } from "bun"
import type { TmuxConfig, TmuxLayout } from "../../config/schema"
import type { SpawnPaneResult } from "./types"
import { getTmuxPath } from "../../tools/interactive-bash/utils"

let serverAvailable: boolean | null = null
let serverCheckUrl: string | null = null

export function isInsideTmux(): boolean {
  return !!process.env.TMUX
}

export async function isServerRunning(serverUrl: string): Promise<boolean> {
  if (serverCheckUrl === serverUrl && serverAvailable === true) {
    return true
  }

  const healthUrl = new URL("/health", serverUrl).toString()
  const timeoutMs = 3000
  const maxAttempts = 2

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(healthUrl, { signal: controller.signal }).catch(
        () => null
      )
      clearTimeout(timeout)

      if (response?.ok) {
        serverCheckUrl = serverUrl
        serverAvailable = true
        return true
      }
    } finally {
      clearTimeout(timeout)
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  return false
}

export function resetServerCheck(): void {
  serverAvailable = null
  serverCheckUrl = null
}

export async function spawnTmuxPane(
  sessionId: string,
  description: string,
  config: TmuxConfig,
  serverUrl: string
): Promise<SpawnPaneResult> {
  if (!config.enabled) return { success: false }
  if (!isInsideTmux()) return { success: false }
  if (!(await isServerRunning(serverUrl))) return { success: false }

  const tmux = await getTmuxPath()
  if (!tmux) return { success: false }

  const opencodeCmd = `opencode attach ${serverUrl} --session ${sessionId}`

  const args = [
    "split-window",
    "-h",
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    opencodeCmd,
  ]

  const proc = spawn([tmux, ...args], { stdout: "pipe", stderr: "pipe" })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const paneId = stdout.trim()

  if (exitCode !== 0 || !paneId) {
    return { success: false }
  }

  const title = `omo-subagent-${description.slice(0, 20)}`
  spawn([tmux, "select-pane", "-t", paneId, "-T", title], {
    stdout: "ignore",
    stderr: "ignore",
  })

  await applyLayout(tmux, config.layout, config.main_pane_size)

  return { success: true, paneId }
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
  if (!isInsideTmux()) return false

  const tmux = await getTmuxPath()
  if (!tmux) return false

  const proc = spawn([tmux, "kill-pane", "-t", paneId], {
    stdout: "ignore",
    stderr: "ignore",
  })
  const exitCode = await proc.exited

  return exitCode === 0
}

export async function applyLayout(
  tmux: string,
  layout: TmuxLayout,
  mainPaneSize: number
): Promise<void> {
  spawn([tmux, "select-layout", layout], { stdout: "ignore", stderr: "ignore" })

  if (layout.startsWith("main-")) {
    const dimension =
      layout === "main-horizontal" ? "main-pane-height" : "main-pane-width"
    spawn([tmux, "set-window-option", dimension, `${mainPaneSize}%`], {
      stdout: "ignore",
      stderr: "ignore",
    })
  }
}
