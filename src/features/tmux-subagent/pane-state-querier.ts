import { spawn } from "bun"
import type { WindowState, TmuxPaneInfo } from "./types"
import { getTmuxPath } from "../../tools/interactive-bash/utils"
import { log } from "../../shared"

/**
 * Query the current window state from tmux.
 * This is the source of truth - not our internal cache.
 */
export async function queryWindowState(sourcePaneId: string): Promise<WindowState | null> {
  const tmux = await getTmuxPath()
  if (!tmux) return null

  // Get window width and all panes in the current window
  const proc = spawn(
    [
      tmux,
      "list-panes",
      "-t",
      sourcePaneId,
      "-F",
      "#{pane_id},#{pane_width},#{pane_left},#{pane_title},#{pane_active},#{window_width}",
    ],
    { stdout: "pipe", stderr: "pipe" }
  )

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()

  if (exitCode !== 0) {
    log("[pane-state-querier] list-panes failed", { exitCode })
    return null
  }

  const lines = stdout.trim().split("\n").filter(Boolean)
  if (lines.length === 0) return null

  let windowWidth = 0
  const panes: TmuxPaneInfo[] = []

  for (const line of lines) {
    const [paneId, widthStr, leftStr, title, activeStr, windowWidthStr] = line.split(",")
    const width = parseInt(widthStr, 10)
    const left = parseInt(leftStr, 10)
    const isActive = activeStr === "1"
    windowWidth = parseInt(windowWidthStr, 10)

    if (!isNaN(width) && !isNaN(left)) {
      panes.push({ paneId, width, left, title, isActive })
    }
  }

  // Sort panes by left position (leftmost first)
  panes.sort((a, b) => a.left - b.left)

  // The main pane is the leftmost pane (where opencode runs)
  // Agent panes are all other panes to the right
  const mainPane = panes.find((p) => p.paneId === sourcePaneId) ?? panes[0] ?? null
  const agentPanes = panes.filter((p) => p.paneId !== mainPane?.paneId)

  log("[pane-state-querier] window state", {
    windowWidth,
    mainPane: mainPane?.paneId,
    agentPaneCount: agentPanes.length,
  })

  return { windowWidth, mainPane, agentPanes }
}
