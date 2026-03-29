import type { ResolvedMultiplexer } from "./multiplexer-runtime"
import { getResolvedMultiplexerRuntime } from "./multiplexer-runtime"

export type SplitDirection = "-h" | "-v"

function resolveRuntime(runtime: ResolvedMultiplexer | undefined): ResolvedMultiplexer | null {
  return runtime ?? getResolvedMultiplexerRuntime()
}

export function isInsideTmuxEnvironment(environment: Record<string, string | undefined>): boolean {
  return Boolean(environment.TMUX)
}

export function isInsideTmux(runtime?: ResolvedMultiplexer): boolean {
  const resolvedRuntime = resolveRuntime(runtime)
  if (resolvedRuntime) {
    return resolvedRuntime.paneBackend === "tmux"
  }

  return isInsideTmuxEnvironment(process.env)
}

export function getCurrentPaneId(runtime?: ResolvedMultiplexer): string | undefined {
  const resolvedRuntime = resolveRuntime(runtime)
  if (resolvedRuntime) {
    if (resolvedRuntime.paneBackend !== "tmux") {
      return undefined
    }
    return resolvedRuntime.tmux.paneId
  }

  return process.env.TMUX_PANE
}

export function isTmuxPaneControlAvailable(runtime?: ResolvedMultiplexer): boolean {
  return isInsideTmux(runtime)
}
