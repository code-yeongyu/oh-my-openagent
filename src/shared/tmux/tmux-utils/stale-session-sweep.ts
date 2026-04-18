const STALE_SESSION_PATTERN = /^omo-agents-(\d+)$/

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		const err = error as NodeJS.ErrnoException
		return err?.code === "EPERM"
	}
}

async function listOmoAgentSessionsViaTmux(tmux: string): Promise<string[]> {
	const { spawn } = await import("./spawn-process")
	const proc = spawn([tmux, "list-sessions", "-F", "#{session_name}"], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const [stdout, , exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])

	if (exitCode !== 0) {
		return []
	}

	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((name) => STALE_SESSION_PATTERN.test(name))
}

export type SweepDeps = {
	isInsideTmux: () => boolean
	getTmuxPath: () => Promise<string | null | undefined>
	listCandidateSessions: (tmux: string) => Promise<string[]>
	killSession: (sessionName: string) => Promise<boolean>
	processAlive: (pid: number) => boolean
	currentPid: number
	log: (message: string, payload?: unknown) => void
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
		listCandidateSessions: listOmoAgentSessionsViaTmux,
		killSession: killTmuxSessionIfExists,
		processAlive: isProcessAlive,
		currentPid: process.pid,
		log,
	}
}

export async function sweepStaleOmoAgentSessionsWith(deps: SweepDeps): Promise<number> {
	if (!deps.isInsideTmux()) {
		return 0
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		return 0
	}

	const candidateSessions = await deps.listCandidateSessions(tmux)
	let killedCount = 0

	for (const sessionName of candidateSessions) {
		const pidMatch = sessionName.match(STALE_SESSION_PATTERN)
		if (!pidMatch) continue

		const pid = Number.parseInt(pidMatch[1], 10)
		if (!Number.isFinite(pid)) continue
		if (pid === deps.currentPid) continue
		if (deps.processAlive(pid)) continue

		deps.log("[sweepStaleOmoAgentSessions] killing stale session", { sessionName, deadPid: pid })
		const killed = await deps.killSession(sessionName)
		if (killed) {
			killedCount += 1
		}
	}

	return killedCount
}

export async function sweepStaleOmoAgentSessions(): Promise<number> {
	const deps = await buildRuntimeDeps()
	return sweepStaleOmoAgentSessionsWith(deps)
}
