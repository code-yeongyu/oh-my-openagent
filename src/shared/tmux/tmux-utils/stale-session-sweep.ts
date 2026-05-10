const STALE_SESSION_PATTERN = /^omo-agents-(\d+)$/

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}

	return String(error)
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		return err?.code === "EPERM"
	}
}

async function listTmuxSessionsViaTmux(tmux: string): Promise<string[]> {
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

export type SweepTmuxSessionsDeps = {
	isInsideTmux: () => boolean
	getTmuxPath: () => Promise<string | null | undefined>
	listCandidateSessions: (tmux: string) => Promise<string[]>
	killSession: (sessionName: string) => Promise<boolean>
	log: (message: string, payload?: unknown) => void
}

export type SweepDeps = SweepTmuxSessionsDeps & {
	processAlive: (pid: number) => boolean
	currentPid: number
}

export type SweepTmuxSessionsOptions = {
	prefix?: string
	predicate?: (sessionName: string) => boolean
}

function matchesSweepOptions(sessionName: string, options: SweepTmuxSessionsOptions): boolean {
	if (options.predicate) {
		return options.predicate(sessionName)
	}

	if (options.prefix) {
		return sessionName.startsWith(options.prefix)
	}

	return true
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
		listCandidateSessions: listTmuxSessionsViaTmux,
		killSession: killTmuxSessionIfExists,
		processAlive: isProcessAlive,
		currentPid: process.pid,
		log,
	}
}

export async function sweepTmuxSessionsWith(
	deps: SweepTmuxSessionsDeps,
	options: SweepTmuxSessionsOptions,
): Promise<string[]> {
	if (!deps.isInsideTmux()) {
		return []
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		return []
	}

	let candidateSessions: string[]

	try {
		candidateSessions = await deps.listCandidateSessions(tmux)
	} catch (error) {
		deps.log("[sweepTmuxSessionsWith] failed to list candidate sessions", {
			error: getErrorMessage(error),
		})
		return []
	}

	const killedSessionNames: string[] = []

	for (const sessionName of candidateSessions) {
		if (!matchesSweepOptions(sessionName, options)) {
			continue
		}

		try {
			const killed = await deps.killSession(sessionName)
			if (killed) {
				killedSessionNames.push(sessionName)
			}
		} catch (error) {
			deps.log("[sweepTmuxSessionsWith] failed to kill stale session", {
				error: getErrorMessage(error),
				sessionName,
			})
		}
	}

	return killedSessionNames
}

export async function sweepStaleOmoAgentSessionsWith(deps: SweepDeps): Promise<number> {
	const killedSessionNames = await sweepTmuxSessionsWith(deps, {
		predicate: (sessionName) => {
			const pidMatch = sessionName.match(STALE_SESSION_PATTERN)
			if (!pidMatch) {
				return false
			}

			const pid = Number.parseInt(pidMatch[1], 10)
			if (!Number.isFinite(pid)) {
				return false
			}

			if (pid === deps.currentPid) {
				return false
			}

			return !deps.processAlive(pid)
		},
	})

	return killedSessionNames.length
}

export async function sweepStaleOmoAgentSessions(): Promise<number> {
	const deps = await buildRuntimeDeps()
	return sweepStaleOmoAgentSessionsWith(deps)
}
