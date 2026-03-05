import { spawn } from "bun"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../logger"

export interface TabIndicatorConfig {
  activeIndicator: string
  inactiveIndicator: string
  showTotal: boolean
  indicatorPosition: "prefix" | "suffix"
}

const DEFAULT_CONFIG: TabIndicatorConfig = {
  activeIndicator: "●",
  inactiveIndicator: "○",
  showTotal: true,
  indicatorPosition: "prefix",
}

export function formatPaneTitle(
  description: string,
  index: number,
  total: number,
  isActive: boolean,
  config: Partial<TabIndicatorConfig> = {}
): string {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  
  const truncatedDesc = description.slice(0, 25)
  const indicator = isActive ? cfg.activeIndicator : cfg.inactiveIndicator
  
  let positionStr: string
  if (cfg.showTotal && total > 1) {
    positionStr = `${index}/${total}`
  } else {
    positionStr = `${index}`
  }
  
  if (cfg.indicatorPosition === "prefix") {
    return `[${positionStr} ${indicator}] ${truncatedDesc}`
  } else {
    return `${indicator} [${positionStr}] ${truncatedDesc}`
  }
}

export async function updatePaneTitle(paneId: string, title: string): Promise<boolean> {
  const tmux = await getTmuxPath()
  if (!tmux) {
    log("[pane-title-indicator] tmux not found")
    return false
  }
  
  const proc = spawn([tmux, "select-pane", "-t", paneId, "-T", title], {
    stdout: "ignore",
    stderr: "pipe",
  })
  
  const exitCode = await proc.exited
  
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text().catch(() => "")
    log("[pane-title-indicator] failed to update pane title", {
      paneId,
      title,
      exitCode,
      stderr: stderr.trim(),
    })
    return false
  }
  
  return true
}

export async function setPaneTitleWithIndicator(
  paneId: string,
  description: string,
  index: number,
  total: number,
  isActive: boolean,
  config?: Partial<TabIndicatorConfig>
): Promise<boolean> {
  const title = formatPaneTitle(description, index, total, isActive, config)
  return updatePaneTitle(paneId, title)
}
