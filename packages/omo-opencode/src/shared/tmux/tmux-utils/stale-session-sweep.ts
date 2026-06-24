import {
  sweepStaleOmoAgentSessionsWith,
  sweepTmuxSessionsWith,
} from "@oh-my-opencode/tmux-core"
import type { SweepDeps, SweepTmuxSessionsDeps, SweepTmuxSessionsOptions } from "@oh-my-opencode/tmux-core"

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined
    return code === "EPERM"
  }
}

async function listCandidateSessions(tmux: string): Promise<string[]> {
  const { runTmuxCommand } = await import("../runner")
  const result = await runTmuxCommand(tmux, ["list-sessions", "-F", "#{session_name}"])

  if (result.exitCode !== 0) {
    return []
  }

  return result.output
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.length > 0)
}

async function buildRuntimeDeps(): Promise<SweepDeps> {
	const [{ log }, { isInsideTmux }, { getTmuxPath }, { killTmuxSessionIfExists }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("./session-kill"),
	])

	return {
		isInsideTmux,
		getTmuxPath,
		listCandidateSessions,
		killSession: killTmuxSessionIfExists,
		processAlive,
		currentPid: process.pid,
		log,
	}
}

export async function sweepStaleOmoAgentSessions(): Promise<number> {
	const deps = await buildRuntimeDeps()
	return sweepStaleOmoAgentSessionsWith(deps)
}

export { sweepStaleOmoAgentSessionsWith, sweepTmuxSessionsWith }
export type { SweepDeps, SweepTmuxSessionsDeps, SweepTmuxSessionsOptions }
