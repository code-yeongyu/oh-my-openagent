import { spawn } from "bun"
import type { WindowState, TmuxPaneInfo } from "./types"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../../shared"

export async function queryWindowState(sourcePaneId: string): Promise<WindowState | null> {
  const tmux = await getTmuxPath()
  if (!tmux) return null

  const proc = spawn(
    [
      tmux,
      "list-panes",
      "-t",
      sourcePaneId,
      "-F",
      "#{pane_id}\t#{pane_width}\t#{pane_height}\t#{pane_left}\t#{pane_top}\t#{pane_title}\t#{pane_active}\t#{window_width}\t#{window_height}",
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
  let windowHeight = 0
  const panes: TmuxPaneInfo[] = []

  for (const line of lines) {
    const [paneId, widthStr, heightStr, leftStr, topStr, title, activeStr, windowWidthStr, windowHeightStr] = line.split("\t")
    const width = parseInt(widthStr, 10)
    const height = parseInt(heightStr, 10)
    const left = parseInt(leftStr, 10)
    const top = parseInt(topStr, 10)
    const isActive = activeStr === "1"
    windowWidth = parseInt(windowWidthStr, 10)
    windowHeight = parseInt(windowHeightStr, 10)

    if (!isNaN(width) && !isNaN(left) && !isNaN(height) && !isNaN(top)) {
      panes.push({ paneId, width, height, left, top, title, isActive })
    }
  }

  panes.sort((a, b) => a.left - b.left || a.top - b.top)

  const mainPane = panes.reduce<TmuxPaneInfo | null>((selected, pane) => {
    if (!selected) return pane
    if (pane.left !== selected.left) {
      return pane.left < selected.left ? pane : selected
    }
    if (pane.width !== selected.width) {
      return pane.width > selected.width ? pane : selected
    }
    if (pane.top !== selected.top) {
      return pane.top < selected.top ? pane : selected
    }
    return pane.paneId === sourcePaneId ? pane : selected
  }, null)
  if (!mainPane) {
    log("[pane-state-querier] CRITICAL: failed to determine main pane", {
      sourcePaneId,
      availablePanes: panes.map((p) => p.paneId),
    })
    return null
  }

  const agentPanes = panes.filter((p) => p.paneId !== mainPane.paneId)

  log("[pane-state-querier] window state", {
    windowWidth,
    windowHeight,
    mainPane: mainPane.paneId,
    agentPaneCount: agentPanes.length,
  })

  return { windowWidth, windowHeight, mainPane, agentPanes }
}
