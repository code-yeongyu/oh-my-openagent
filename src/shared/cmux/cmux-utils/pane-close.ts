import { spawn } from "bun"
import type { CmuxConfig } from "../../../config/schema/cmux"
import { isInsideCmux, getCmuxSocketPath } from "./environment"

export async function closeCmuxPane(
  paneId: string,
  config: CmuxConfig,
): Promise<{ success: boolean; error?: string }> {
  const { log } = await import("../../logger")

  log("[closeCmuxPane] called", { paneId, configEnabled: config.enabled })

  if (!config.enabled) {
    log("[closeCmuxPane] SKIP: config.enabled is false")
    return { success: false }
  }

  if (!isInsideCmux()) {
    log("[closeCmuxPane] SKIP: not inside cmux")
    return { success: false }
  }

  const socketPath = getCmuxSocketPath()
  if (!socketPath) {
    log("[closeCmuxPane] SKIP: cmux socket not found")
    return { success: false }
  }

  const request = {
    id: `close-${paneId}-${Date.now()}`,
    method: "surface.close",
    params: {
      surface_id: paneId,
    },
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

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    log("[closeCmuxPane] ERROR: cmux rpc failed", {
      exitCode,
      stderr: stderr.trim(),
    })
    return { success: false, error: stderr.trim() }
  }

  try {
    const response = JSON.parse(stdout.trim())
    if (!response.ok) {
      const errorMsg = response.error?.message || "Unknown cmux error"
      log("[closeCmuxPane] ERROR: cmux returned error", { error: errorMsg })
      return { success: false, error: errorMsg }
    }
  } catch (e) {
    log("[closeCmuxPane] WARNING: failed to parse response", {
      stdout: stdout.trim(),
      error: String(e),
    })
  }

  return { success: true }
}
