import type { TeamModeConfig } from "../../config/schema/team-mode"

export interface TeamModeDependencyReport {
  tmuxAvailable: boolean
  gitAvailable: boolean
}

export async function checkTeamModeDependencies(
  config: TeamModeConfig,
): Promise<TeamModeDependencyReport> {
  const tmuxAvailable = Boolean(process.env["TMUX"]) || (await probeBinary("tmux", ["-V"]))
  const gitAvailable = await probeBinary("git", ["--version"])
  if (config.tmux_visualization && !tmuxAvailable) {
    console.warn(
      "[team-mode] tmux_visualization=true but tmux not available; layout will be skipped at runtime",
    )
  }
  return { tmuxAvailable, gitAvailable }
}

async function probeBinary(cmd: string, args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn({ cmd: [cmd, ...args], stdout: "pipe", stderr: "pipe" })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}
