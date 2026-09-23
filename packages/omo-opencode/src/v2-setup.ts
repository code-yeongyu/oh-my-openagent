import type { Plugin } from "@opencode/plugin"
import { log as defaultLog } from "./shared/logger"

export type V2SetupDeps = {
  log: typeof defaultLog
}

const defaultDeps: V2SetupDeps = {
  log: defaultLog,
}

export function createV2Setup(overrides: Partial<V2SetupDeps> = {}): (ctx: Plugin.Context) => () => void {
  const deps = { ...defaultDeps, ...overrides }
  return (ctx: Plugin.Context) => {
    const controller = new AbortController()
    deps.log("[oh-my-openagent] V2 setup loaded (minimal, hooks follow in later phases)", {
      directory: ctx.location.directory,
      projectId: ctx.location.project.id,
    })
    void controller.signal
    return () => {
      controller.abort()
    }
  }
}
