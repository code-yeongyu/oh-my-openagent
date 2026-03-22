import type { TmuxConfig } from "../../config/schema"
import type { CmuxConfig } from "../../config/schema/cmux"
import type { SpawnPaneResult } from "../tmux/types"
import * as tmux from "../tmux"
import * as cmux from "../cmux"

export type MultiplexerType = "tmux" | "cmux" | "none"

export function detectMultiplexer(): MultiplexerType {
  if (cmux.isInsideCmux()) return "cmux"
  if (tmux.isInsideTmux()) return "tmux"
  return "none"
}

export function isInsideMultiplexer(): boolean {
  return detectMultiplexer() !== "none"
}

export function getCurrentPaneId(): string | undefined {
  const mux = detectMultiplexer()
  if (mux === "cmux") {
    const ctx = cmux.getCmuxContext()
    return ctx.surfaceId
  }
  return tmux.getCurrentPaneId()
}

export async function spawnPane(
  sessionId: string,
  description: string,
  tmuxConfig: TmuxConfig,
  cmuxConfig: CmuxConfig,
  serverUrl: string,
  targetPaneId?: string,
  splitDirection: "-h" | "-v" = "-h"
): Promise<SpawnPaneResult> {
  const mux = detectMultiplexer()
  
  if (mux === "cmux") {
    const cmuxDirection = cmux.mapTmuxDirectionToCmux(splitDirection)
    return cmux.spawnCmuxPane(
      sessionId,
      description,
      cmuxConfig,
      serverUrl,
      targetPaneId,
      cmuxDirection
    )
  }
  
  if (mux === "tmux") {
    return tmux.spawnTmuxPane(
      sessionId,
      description,
      tmuxConfig,
      serverUrl,
      targetPaneId,
      splitDirection
    )
  }
  
  return { success: false }
}

export async function closePane(
  paneId: string,
  tmuxConfig: TmuxConfig,
  cmuxConfig: CmuxConfig
): Promise<boolean> {
  const mux = detectMultiplexer()
  
  if (mux === "cmux") {
    const result = await cmux.closeCmuxPane(paneId, cmuxConfig)
    return result.success
  }
  
  if (mux === "tmux") {
    return tmux.closeTmuxPane(paneId)
  }
  
  return false
}

export async function replacePane(
  paneId: string,
  sessionId: string,
  description: string,
  tmuxConfig: TmuxConfig,
  cmuxConfig: CmuxConfig,
  serverUrl: string,
  splitDirection?: "-h" | "-v"
): Promise<SpawnPaneResult> {
  const mux = detectMultiplexer()
  
  if (mux === "cmux") {
    const cmuxDirection = splitDirection ? cmux.mapTmuxDirectionToCmux(splitDirection) : "vertical"
    return cmux.replaceCmuxPane(
      paneId,
      sessionId,
      description,
      cmuxConfig,
      serverUrl,
      cmuxDirection
    )
  }
  
  if (mux === "tmux") {
    return tmux.replaceTmuxPane(
      paneId,
      sessionId,
      description,
      tmuxConfig,
      serverUrl
    )
  }
  
  return { success: false }
}

export async function applyLayout(
  layout: string,
  mainPaneSize: number,
  tmuxConfig: TmuxConfig,
  cmuxConfig: CmuxConfig
): Promise<void> {
  const mux = detectMultiplexer()
  
  if (mux === "cmux") {
    await cmux.applyLayout(layout as CmuxConfig["layout"], cmuxConfig)
    return
  }
  
  if (mux === "tmux") {
    const { getTmuxPath } = await import("../../tools/interactive-bash/tmux-path-resolver")
    const tmuxPath = await getTmuxPath()
    if (tmuxPath) {
      await tmux.applyLayout(tmuxPath, layout as TmuxConfig["layout"], mainPaneSize)
    }
    return
  }
}

export async function enforceMainPaneWidth(
  paneId: string,
  windowWidth: number,
  tmuxConfig: TmuxConfig,
  cmuxConfig: CmuxConfig
): Promise<void> {
  const mux = detectMultiplexer()
  
  if (mux === "cmux") {
    await cmux.enforceMainPaneWidth(paneId, cmuxConfig)
    return
  }
  
  if (mux === "tmux") {
    await tmux.enforceMainPaneWidth(paneId, windowWidth, {
      mainPaneSize: tmuxConfig.main_pane_size,
      mainPaneMinWidth: tmuxConfig.main_pane_min_width,
      agentPaneMinWidth: tmuxConfig.agent_pane_min_width,
    })
    return
  }
}
