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

export type SplitDirection = "-h" | "-v"

export function getCurrentPaneId(): string | undefined {
  return process.env.TMUX_PANE
}

export interface PaneDimensions {
  paneWidth: number
  windowWidth: number
}

export async function getPaneDimensions(paneId: string): Promise<PaneDimensions | null> {
  const tmux = await getTmuxPath()
  if (!tmux) return null

  const proc = spawn([tmux, "display", "-p", "-t", paneId, "#{pane_width},#{window_width}"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()

  if (exitCode !== 0) return null

  const [paneWidth, windowWidth] = stdout.trim().split(",").map(Number)
  if (isNaN(paneWidth) || isNaN(windowWidth)) return null

  return { paneWidth, windowWidth }
}

export async function spawnTmuxPane(
  sessionId: string,
  description: string,
  config: TmuxConfig,
  serverUrl: string,
  targetPaneId?: string,
  splitDirection: SplitDirection = "-h"
): Promise<SpawnPaneResult> {
  const { log } = await import("../logger")
  
  log("[spawnTmuxPane] called", { sessionId, description, serverUrl, configEnabled: config.enabled, targetPaneId, splitDirection })
  
  if (!config.enabled) {
    log("[spawnTmuxPane] SKIP: config.enabled is false")
    return { success: false }
  }
  if (!isInsideTmux()) {
    log("[spawnTmuxPane] SKIP: not inside tmux", { TMUX: process.env.TMUX })
    return { success: false }
  }
  
  const serverRunning = await isServerRunning(serverUrl)
  if (!serverRunning) {
    log("[spawnTmuxPane] SKIP: server not running", { serverUrl })
    return { success: false }
  }

  const tmux = await getTmuxPath()
  if (!tmux) {
    log("[spawnTmuxPane] SKIP: tmux not found")
    return { success: false }
  }
  
  log("[spawnTmuxPane] all checks passed, spawning...")

  const opencodeCmd = `opencode attach ${serverUrl} --session ${sessionId}`

  const args = [
    "split-window",
    splitDirection,
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
    ...(targetPaneId ? ["-t", targetPaneId] : []),
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

  return { success: true, paneId }
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
  const { log } = await import("../logger")
  
  if (!isInsideTmux()) {
    log("[closeTmuxPane] SKIP: not inside tmux")
    return false
  }

  const tmux = await getTmuxPath()
  if (!tmux) {
    log("[closeTmuxPane] SKIP: tmux not found")
    return false
  }

  log("[closeTmuxPane] killing pane", { paneId })
  
  const proc = spawn([tmux, "kill-pane", "-t", paneId], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    log("[closeTmuxPane] FAILED", { paneId, exitCode, stderr: stderr.trim() })
  } else {
    log("[closeTmuxPane] SUCCESS", { paneId })
  }

  return exitCode === 0
}

export async function replaceTmuxPane(
  paneId: string,
  sessionId: string,
  description: string,
  config: TmuxConfig,
  serverUrl: string
): Promise<SpawnPaneResult> {
  const { log } = await import("../logger")
  
  log("[replaceTmuxPane] called", { paneId, sessionId, description })
  
  if (!config.enabled) {
    return { success: false }
  }
  if (!isInsideTmux()) {
    return { success: false }
  }

  const tmux = await getTmuxPath()
  if (!tmux) {
    return { success: false }
  }

  const opencodeCmd = `opencode attach ${serverUrl} --session ${sessionId}`

  const proc = spawn([tmux, "respawn-pane", "-k", "-t", paneId, opencodeCmd], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    log("[replaceTmuxPane] FAILED", { paneId, exitCode, stderr: stderr.trim() })
    return { success: false }
  }

  const title = `omo-subagent-${description.slice(0, 20)}`
  spawn([tmux, "select-pane", "-t", paneId, "-T", title], {
    stdout: "ignore",
    stderr: "ignore",
  })

  log("[replaceTmuxPane] SUCCESS", { paneId, sessionId })
  return { success: true, paneId }
}

export async function applyLayout(
  tmux: string,
  layout: TmuxLayout,
  mainPaneSize: number
): Promise<void> {
  const layoutProc = spawn([tmux, "select-layout", layout], { stdout: "ignore", stderr: "ignore" })
  await layoutProc.exited

  if (layout.startsWith("main-")) {
    const dimension =
      layout === "main-horizontal" ? "main-pane-height" : "main-pane-width"
    const sizeProc = spawn([tmux, "set-window-option", dimension, `${mainPaneSize}%`], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await sizeProc.exited
  }
}

export async function enforceMainPaneWidth(
  mainPaneId: string,
  windowWidth: number
): Promise<void> {
  const { log } = await import("../logger")
  const tmux = await getTmuxPath()
  if (!tmux) return

  const DIVIDER_WIDTH = 1
  const mainWidth = Math.floor((windowWidth - DIVIDER_WIDTH) / 2)
  
  const proc = spawn([tmux, "resize-pane", "-t", mainPaneId, "-x", String(mainWidth)], {
    stdout: "ignore",
    stderr: "ignore",
  })
  await proc.exited
  
  log("[enforceMainPaneWidth] main pane resized", { mainPaneId, mainWidth, windowWidth })
}
