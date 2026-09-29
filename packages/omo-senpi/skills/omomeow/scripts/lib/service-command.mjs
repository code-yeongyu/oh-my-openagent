import { basename } from "node:path"

import { print, UsageError } from "./cli-context.mjs"
import { loadOmoMeowSettings } from "./config.mjs"
import { buildNudgeServiceSpec, installNudgeService, nudgeServiceStatus, renderNudgeService, uninstallNudgeService } from "./service.mjs"
import { findOnPath, syncRuntime } from "./system.mjs"

export function serviceCommand(ctx, _values, [action]) {
  if (action === "status") {
    print(nudgeServiceStatus({ env: ctx.env }))
    return 0
  }
  if (action === "uninstall") {
    const result = uninstallNudgeService({ env: ctx.env })
    print(result)
    return result.ok ? 0 : 1
  }
  if (action !== "render" && action !== "install") throw new UsageError("service status|render|install|uninstall")
  const { settings } = loadOmoMeowSettings({ cwd: ctx.cwd, env: ctx.env })
  // Prefer the PATH entry (e.g. /opt/homebrew/bin/node) over process.execPath, which can be a
  // versioned install dir that disappears on the next runtime upgrade.
  const runtimeName = basename(process.execPath).replace(/\.exe$/i, "")
  const nodeBin = findOnPath(runtimeName, ctx.env) ?? process.execPath
  const spec = buildNudgeServiceSpec({ nodeBin, stateDir: ctx.stateDir, intervalMinutes: settings.nudge.interval_minutes, cwd: ctx.cwd, env: ctx.env })
  // Both actions need the runtime copy the service command points at.
  const runtime = syncRuntime(ctx.stateDir)
  if (action === "render") {
    print({ runtime, spec, ...renderNudgeService(spec, { env: ctx.env }) })
    return 0
  }
  const result = installNudgeService({ spec, env: ctx.env })
  print({ runtime, spec, ...result })
  return result.ok ? 0 : 1
}
