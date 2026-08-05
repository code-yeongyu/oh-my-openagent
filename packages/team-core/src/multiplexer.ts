import { isHerdrEnvironment } from "@oh-my-opencode/herdr-core"
import type { TeamModeConfig } from "./config"

export type TeamMultiplexer = "tmux" | "herdr"

/**
 * Resolve which multiplexer backend TeamMode visualization should use.
 * "auto" (the default) picks herdr when the current process runs inside a
 * herdr pane (HERDR_ENV/HERDR_SOCKET_PATH set), otherwise tmux.
 */
export function resolveTeamMultiplexer(
  config: TeamModeConfig,
  environment: Record<string, string | undefined> = process.env,
): TeamMultiplexer {
  if (config.multiplexer === "herdr") return "herdr"
  if (config.multiplexer === "tmux") return "tmux"
  return isHerdrEnvironment(environment) ? "herdr" : "tmux"
}
