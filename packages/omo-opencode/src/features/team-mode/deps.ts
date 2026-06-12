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
}

export async function checkTeamModeDependencies(
  config: TeamModeConfig,
  deps: TeamModeDependencyDeps = {},
): Promise<TeamModeDependencyReport> {
  const spawnImpl = deps.spawn ?? spawn
  const tmuxEnv = deps.tmuxEnv ?? process.env["TMUX"]
  const tmuxAvailable = Boolean(tmuxEnv) || (await probeBinary("tmux", ["-V"], spawnImpl))
  const gitAvailable = await probeBinary("git", ["--version"], spawnImpl)
  if (config.tmux_visualization && !tmuxAvailable) {
    console.warn(
      "[team-mode] tmux_visualization=true but tmux not available; layout will be skipped at runtime",
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
