import { spawn } from "bun"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../../shared"

/**
 * Configuration for tab indicator appearance
 */
export interface TabIndicatorConfig {
  /**
   * Character to indicate active pane (default: "●")
   */
  activeIndicator: string
  /**
   * Character to indicate inactive pane (default: "○" or empty)
   */
  inactiveIndicator: string
  /**
   * Include total count in indicator (default: true)
   */
  showTotal: boolean
  /**
   * Format: "[index/total indicator] description" or "indicator [index/total] description"
   */
  indicatorPosition: "prefix" | "suffix"
}

const DEFAULT_CONFIG: TabIndicatorConfig = {
  activeIndicator: "●",
  inactiveIndicator: "○",
  showTotal: true,
  indicatorPosition: "prefix",
}

/**
 * Format a pane title with tab indicators
 * 
 * Examples:
 * - [1/3 ●] SubagentName (active, showing total)
 * - [2/3 ○] SubagentName (inactive, showing total)
 * - [1 ●] SubagentName (active, no total)
 * 
 * @param description - Base description of the subagent
 * @param index - Position in the list (1-based)
 * @param total - Total number of subagents
 * @param isActive - Whether this pane is currently active
 * @param config - Optional configuration override
 * @returns Formatted pane title
 */
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
    return `omo-subagent-[${positionStr} ${indicator}] ${truncatedDesc}`
  } else {
    return `omo-subagent-${indicator} [${positionStr}] ${truncatedDesc}`
  }
}

/**
 * Update the title of a tmux pane
 * 
 * @param paneId - The tmux pane ID (e.g., "%42")
 * @param title - The new title to set
 * @returns Promise resolving to success status
 */
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

/**
 * Format and update pane title in one operation
 * 
 * @param paneId - The tmux pane ID
 * @param description - Base description
 * @param index - Position index (1-based)
 * @param total - Total count
 * @param isActive - Whether pane is active
 * @param config - Optional configuration
 * @returns Promise resolving to success status
 */
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
