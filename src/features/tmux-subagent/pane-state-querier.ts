import { spawn } from "bun"
import type { WindowState, TmuxPaneInfo } from "./types"
import { parsePaneStateOutput } from "./pane-state-parser"
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
			"#{pane_id}\t#{pane_width}\t#{pane_height}\t#{pane_left}\t#{pane_top}\t#{pane_active}\t#{window_width}\t#{window_height}\t#{pane_title}",
    ],
    { stdout: "pipe", stderr: "pipe" }
  )

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()

  if (exitCode !== 0) {
    log("[pane-state-querier] list-panes failed", { exitCode })
    return null
  }

  const parsedPaneState = parsePaneStateOutput(stdout)
  if (!parsedPaneState) {
    log("[pane-state-querier] failed to parse pane state output", {
      sourcePaneId,
    })
    return null
  }

  const { panes } = parsedPaneState
  const windowWidth = parsedPaneState.windowWidth
  const windowHeight = parsedPaneState.windowHeight

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
