import type { TeamModeConfig } from "../../config/schema/team-mode"
import { spawn } from "../../shared/bun-spawn-shim"

export interface TeamModeDependencyReport {
  tmuxAvailable: boolean
  gitAvailable: boolean
}

type Spawn = typeof spawn

type TeamModeDependencyDeps = {
  readonly spawn?: Spawn
  readonly tmuxEnv?: string
  /**
   * The resolved visualization backend. Callers that already loaded the
   * runtime tmux config (createRuntimeTmuxConfig) thread it here so a
   * config-only `tmux.multiplexer: "herdr"` is honored; without it only the
   * OMO_TMUX_MULTIPLEXER env override applies.
   */
  readonly multiplexer?: "tmux" | "herdr"
  readonly herdrEnv?: string
}

export async function checkTeamModeDependencies(
  config: TeamModeConfig,
  deps: TeamModeDependencyDeps = {},
): Promise<TeamModeDependencyReport> {
  const spawnImpl = deps.spawn ?? spawn
  const multiplexer = deps.multiplexer ?? readMultiplexerEnv()
  const tmuxEnv = deps.tmuxEnv ?? process.env["TMUX"]
  const herdrEnv = deps.herdrEnv ?? process.env["HERDR_ENV"]
  const tmuxAvailable = multiplexer === "herdr"
    ? Boolean(herdrEnv) || (await probeBinary("herdr", ["--version"], spawnImpl))
    : Boolean(tmuxEnv) || (await probeBinary("tmux", ["-V"], spawnImpl))
  const gitAvailable = await probeBinary("git", ["--version"], spawnImpl)
  if (config.tmux_visualization && !tmuxAvailable) {
    console.warn(
      multiplexer === "herdr"
        ? "[team-mode] tmux_visualization=true with multiplexer=herdr but the herdr binary is not available; layout will be skipped at runtime"
        : "[team-mode] tmux_visualization=true but tmux not available; layout will be skipped at runtime",
    )
  }
  return { tmuxAvailable, gitAvailable }
}

async function probeBinary(cmd: string, args: string[], spawnImpl: Spawn): Promise<boolean> {
  try {
    const proc = spawnImpl({ cmd: [cmd, ...args], stdout: "pipe", stderr: "pipe" })
    const code = await proc.exited
    return code === 0
  } catch (error) {
    error instanceof Error
    return false
  }
}

function readMultiplexerEnv(): "tmux" | "herdr" {
  const value = (process.env["OMO_TMUX_MULTIPLEXER"] ?? "").trim().toLowerCase()
  return value === "herdr" ? "herdr" : "tmux"
}
