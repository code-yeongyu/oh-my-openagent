import { spawn } from "bun"
import type { CmuxConfig, CmuxLayout } from "../../../config/schema/cmux"
import { isInsideCmux, getCmuxSocketPath } from "./environment"

export async function applyLayout(
  layout: CmuxLayout,
  config: CmuxConfig
): Promise<{ success: boolean; error?: string }> {
  const { log } = await import("../../logger")

  log("[applyLayout] called", { layout, configEnabled: config.enabled })

  if (!config.enabled) {
    log("[applyLayout] SKIP: config.enabled is false")
    return { success: false }
  }

  if (!isInsideCmux()) {
    log("[applyLayout] SKIP: not inside cmux")
    return { success: false }
  }

  const socketPath = getCmuxSocketPath()
  if (!socketPath) {
    log("[applyLayout] SKIP: cmux socket not found")
    return { success: false }
  }

  const request = {
    id: `layout-${Date.now()}`,
    method: "workspace.apply_layout",
    params: {
      layout,
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
    log("[applyLayout] ERROR: cmux rpc failed", {
      exitCode,
      stderr: stderr.trim(),
    })
    return { success: false, error: stderr.trim() }
  }

  try {
    const response = JSON.parse(stdout.trim())
    if (!response.ok) {
      const errorMsg = response.error?.message || "Unknown cmux error"
      log("[applyLayout] ERROR: cmux returned error", { error: errorMsg })
      return { success: false, error: errorMsg }
    }
  } catch (e) {
    log("[applyLayout] WARNING: failed to parse response", {
      stdout: stdout.trim(),
      error: String(e),
    })
  }

  return { success: true }
}

export async function enforceMainPaneWidth(
  paneId: string,
  config: CmuxConfig
): Promise<{ success: boolean; error?: string }> {
  const { log } = await import("../../logger")

  log("[enforceMainPaneWidth] called", { paneId, mainPaneSize: config.main_pane_size })

  if (!config.enabled) {
    return { success: false }
  }

  if (!isInsideCmux()) {
    return { success: false }
  }

  const socketPath = getCmuxSocketPath()
  if (!socketPath) {
    return { success: false }
  }

  const request = {
    id: `resize-${paneId}-${Date.now()}`,
    method: "surface.resize",
    params: {
      surface_id: paneId,
      width_percent: config.main_pane_size,
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
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    log("[enforceMainPaneWidth] ERROR: cmux rpc failed", {
      exitCode,
      stderr: stderr.trim(),
    })
    return { success: false, error: stderr.trim() }
  }

  return { success: true }
}
