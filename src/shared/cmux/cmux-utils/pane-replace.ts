import { spawn } from "bun"
import type { CmuxConfig } from "../../../config/schema/cmux"
import type { SpawnPaneResult } from "../types"
import type { CmuxSplitDirection } from "./environment"
import { isInsideCmux, getCmuxSocketPath, getCmuxContext } from "./environment"
import { isServerRunning } from "./server-health"
import { shellEscapeForDoubleQuotedCommand } from "../../shell-env"

export async function replaceCmuxPane(
  paneId: string,
  sessionId: string,
  description: string,
  config: CmuxConfig,
  serverUrl: string,
  splitDirection: CmuxSplitDirection = "vertical",
): Promise<SpawnPaneResult> {
  const { log } = await import("../../logger")

  log("[replaceCmuxPane] called", {
    paneId,
    sessionId,
    description,
    configEnabled: config.enabled,
  })

  if (!config.enabled) {
    log("[replaceCmuxPane] SKIP: config.enabled is false")
    return { success: false }
  }

  if (!isInsideCmux()) {
    log("[replaceCmuxPane] SKIP: not inside cmux")
    return { success: false }
  }

  const serverRunning = await isServerRunning(serverUrl)
  if (!serverRunning) {
    log("[replaceCmuxPane] SKIP: server not running", { serverUrl })
    return { success: false }
  }

  const socketPath = getCmuxSocketPath()
  if (!socketPath) {
    log("[replaceCmuxPane] SKIP: cmux socket not found")
    return { success: false }
  }

  const shell = process.env.SHELL || "/bin/sh"
  const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
  const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${sessionId}"`

  const { workspaceId } = getCmuxContext()

  const replaceParams: Record<string, unknown> = {
    surface_id: paneId,
    command: opencodeCmd,
    direction: splitDirection,
  }

  if (workspaceId) {
    replaceParams.workspace_id = workspaceId
  }

  const request = {
    id: `replace-${sessionId}-${Date.now()}`,
    method: "surface.replace",
    params: replaceParams,
  }

  const proc = spawn(
    ["cmux", "rpc", JSON.stringify(request)],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, CMUX_SOCKET_PATH: socketPath },
    }
  )

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode !== 0) {
    log("[replaceCmuxPane] ERROR: cmux rpc failed", {
      exitCode,
      stderr: stderr.trim(),
    })
    return { success: false, error: stderr.trim() }
  }

  let response: { ok?: boolean; result?: { surface_id?: string; id?: string }; error?: { message?: string } }
  try {
    response = JSON.parse(stdout.trim())
  } catch (e) {
    log("[replaceCmuxPane] ERROR: failed to parse cmux response", {
      stdout: stdout.trim(),
      error: String(e),
    })
    return { success: false, error: "Invalid JSON response from cmux" }
  }

  if (!response.ok) {
    const errorMsg = response.error?.message || "Unknown cmux error"
    log("[replaceCmuxPane] ERROR: cmux returned error", { error: errorMsg })
    return { success: false, error: errorMsg }
  }

  const newSurfaceId = response.result?.surface_id || response.result?.id || paneId

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
        env: { ...process.env, CMUX_SOCKET_PATH: socketPath },
      }
    )
    await renameProc.exited
  } catch (e) {
    log("[replaceCmuxPane] WARNING: failed to set surface title", {
      newSurfaceId,
      title,
      error: String(e),
    })
  }

  return { success: true, paneId: newSurfaceId }
}
