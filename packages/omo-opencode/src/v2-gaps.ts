import type { OhMyOpenCodeConfig } from "./config"
import { log } from "./shared/logger"

// Systems with no V2 equivalent in the current port (see ADR-004). When the
// user enables one, say so loudly at startup instead of silently ignoring it.
export function unsupportedEnabledSystems(pluginConfig: OhMyOpenCodeConfig): string[] {
  const unsupported: string[] = []
  if (pluginConfig.team_mode?.enabled === true) {
    unsupported.push("team_mode: parallel multi-agent coordination needs session management with no V2 equivalent yet")
  }
  if (pluginConfig.monitor?.enabled === true) {
    unsupported.push("monitor: background output monitors need session lifecycle APIs with no V2 equivalent yet")
  }
  if (pluginConfig.goal?.enabled === true) {
    unsupported.push("goal: goal tracking needs command-interception state with no V2 global hook yet")
  }
  if (pluginConfig.openclaw !== undefined) {
    unsupported.push("openclaw: bidirectional relay needs daemon + tmux integration with no V2 equivalent yet")
  }
  return unsupported
}

export function warnUnsupportedSystems(pluginConfig: OhMyOpenCodeConfig): void {
  for (const reason of unsupportedEnabledSystems(pluginConfig)) {
    log("[oh-my-openagent] v2 port does not support enabled system", { reason })
  }
}
