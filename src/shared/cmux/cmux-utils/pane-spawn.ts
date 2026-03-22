import { spawn } from "bun"
import type { CmuxConfig } from "../../../config/schema/cmux"
import type { SpawnPaneResult } from "../types"
import type { CmuxSplitDirection } from "./environment"
import { isInsideCmux, getCmuxSocketPath, mapTmuxDirectionToCmux, getCmuxContext } from "./environment"
import { isServerRunning } from "./server-health"
import { shellEscapeForDoubleQuotedCommand } from "../../shell-env"

export interface CmuxSpawnOptions {
  sessionId: string
  description: string
  config: CmuxConfig
  serverUrl: string
  targetPaneId?: string
  splitDirection?: CmuxSplitDirection
}

export async function spawnCmuxPane(
  sessionId: string,
  description: string,
  config: CmuxConfig,
  serverUrl: string,
  targetPaneId?: string,
  splitDirection: CmuxSplitDirection = "vertical",
): Promise<SpawnPaneResult> {
  const { log } = await import("../../logger")

  log("[spawnCmuxPane] called", {
    sessionId,
    description,
    serverUrl,
    configEnabled: config.enabled,
    targetPaneId,
    splitDirection,
  })

  if (!config.enabled) {
    log("[spawnCmuxPane] SKIP: config.enabled is false")
    return { success: false }
  }

  if (!isInsideCmux()) {
    log("[spawnCmuxPane] SKIP: not inside cmux", { 
      CMUX_SOCKET_PATH: process.env.CMUX_SOCKET_PATH,
      CMUX_SOCKET: process.env.CMUX_SOCKET 
    })
    return { success: false }
  }

  const serverRunning = await isServerRunning(serverUrl)
  if (!serverRunning) {
    log("[spawnCmuxPane] SKIP: server not running", { serverUrl })
    return { success: false }
  }

  const socketPath = getCmuxSocketPath()
  if (!socketPath) {
    log("[spawnCmuxPane] SKIP: cmux socket not found")
    return { success: false }
  }

  log("[spawnCmuxPane] all checks passed, spawning...")

  const shell = process.env.SHELL || "/bin/sh"
  const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
  const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

  const { workspaceId, surfaceId: currentSurfaceId } = getCmuxContext()

  const splitParams: Record<string, unknown> = {
    direction: splitDirection,
    command: opencodeCmd,
  }

  if (targetPaneId || currentSurfaceId) {
    splitParams.target_surface_id = targetPaneId || currentSurfaceId
  }

  if (workspaceId) {
    splitParams.workspace_id = workspaceId
  }

  const request = {
    id: `spawn-${sessionId}-${Date.now()}`,
    method: "surface.split",
    params: splitParams,
  }

  const requestJson = JSON.stringify(request)

  const proc = spawn(
    ["cmux", "rpc", requestJson],
    { 
      stdout: "pipe", 
      stderr: "pipe",
      env: { ...process.env, CMUX_SOCKET_PATH: socketPath }
    }
  )

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    log("[spawnCmuxPane] ERROR: cmux rpc failed", {
      exitCode,
      stderr: stderr.trim(),
    })
    return { success: false, error: stderr.trim() }
  }

  let response: { ok?: boolean; result?: { surface_id?: string; id?: string }; error?: { message?: string } }
  try {
    response = JSON.parse(stdout.trim())
  } catch (e) {
    log("[spawnCmuxPane] ERROR: failed to parse cmux response", {
      stdout: stdout.trim(),
      error: String(e),
    })
    return { success: false, error: "Invalid JSON response from cmux" }
  }

  if (!response.ok) {
    const errorMsg = response.error?.message || "Unknown cmux error"
    log("[spawnCmuxPane] ERROR: cmux returned error", { error: errorMsg })
    return { success: false, error: errorMsg }
  }

  const newSurfaceId = response.result?.surface_id || response.result?.id
  if (!newSurfaceId) {
    log("[spawnCmuxPane] ERROR: no surface_id in response", { response })
    return { success: false, error: "No surface_id in cmux response" }
  }

  const title = `omo-subagent-${description.slice(0, 20)}`
  
  try {
    const renameRequest = {
      id: `rename-${sessionId}-${Date.now()}`,
      method: "surface.set_title",
      params: {
        surface_id: newSurfaceId,
        title,
        ...(workspaceId && { workspace_id: workspaceId }),
      },
    }
    
    const renameProc = spawn(
      ["cmux", "rpc", JSON.stringify(renameRequest)],
      { 
        stdout: "ignore", 
        stderr: "pipe",
        env: { ...process.env, CMUX_SOCKET_PATH: socketPath }
      }
    )
    await renameProc.exited
  } catch (e) {
    log("[spawnCmuxPane] WARNING: failed to set surface title", {
      newSurfaceId,
      title,
      error: String(e),
    })
  }

  return { success: true, paneId: newSurfaceId }
}
