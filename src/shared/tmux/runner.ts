import { spawn } from "../bun-spawn-shim"

type RunTmuxOptions = {
	retry?: number
	timeoutMs?: number
}

export type TmuxCommandResult = {
	success: boolean
	output: string
	stdout: string
	stderr: string
	exitCode: number
}

const TERMINAL_TMUX_ERROR_PATTERN = /can't find (pane|session)/i

function createTmuxCommandResult(stdout: string, stderr: string, exitCode: number): TmuxCommandResult {
	return {
		success: exitCode === 0,
		output: stdout,
		stdout,
		stderr,
		exitCode,
	}
}

function isTerminalTmuxError(stderr: string): boolean {
	return TERMINAL_TMUX_ERROR_PATTERN.test(stderr)
}

/**
 * Detect whether we are running inside cmux (cmux omo).
 * When cmux-omo sets up the environment it injects a tmux shim and sets
 * CMUX_SOCKET_PATH / TMUX. If detected, redirect tmux commands to
 * `cmux __tmux-compat` so they become native cmux splits instead of
 * failing because there is no real tmux server running.
 */
function resolveTmuxExecutable(tmuxPath: string): string[] {
	const inCmux = Boolean(process.env.CMUX_SOCKET_PATH) ||
		process.env.TMUX?.includes("cmuxterm") === true
	if (inCmux) {
		return ["cmux", "__tmux-compat"]
	}
	return [tmuxPath]
}

async function runTmuxCommandOnce(tmuxPath: string, args: Array<string>, timeoutMs?: number): Promise<TmuxCommandResult> {
	const abortController = new AbortController()
	const subprocess = spawn([...resolveTmuxExecutable(tmuxPath), ...args], {
		stdout: "pipe",
		stderr: "pipe",
		signal: abortController.signal,
	})
	const stdoutPromise = new Response(subprocess.stdout).text()
	const stderrPromise = new Response(subprocess.stderr).text()

	let timeoutId: ReturnType<typeof setTimeout> | undefined

	try {
		const exitCodeOrTimeout = timeoutMs === undefined
			? await subprocess.exited
			: await Promise.race<number | "timeout">(([
					subprocess.exited,
					new Promise<"timeout">((resolve) => {
						timeoutId = setTimeout(() => {
							abortController.abort()
							resolve("timeout")
						}, timeoutMs)
					}),
				]))

		if (exitCodeOrTimeout === "timeout") {
			void subprocess.exited.catch(() => undefined)
			void stdoutPromise.catch(() => "")
			void stderrPromise.catch(() => "")
			return createTmuxCommandResult("", "timeout", -1)
		}

		const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
		return createTmuxCommandResult(stdout.trim(), stderr.trim(), exitCodeOrTimeout)
	} finally {
		if (timeoutId !== undefined) {
			clearTimeout(timeoutId)
		}
	}
}

export async function runTmuxCommand(tmuxPath: string, args: string[], options: RunTmuxOptions = {}): Promise<TmuxCommandResult> {
	const retryCount = Math.max(0, options.retry ?? 0)
	let lastResult = createTmuxCommandResult("", "", 1)

	for (let attempt = 0; attempt <= retryCount; attempt += 1) {
		const result = await runTmuxCommandOnce(tmuxPath, args, options.timeoutMs)
		lastResult = result

		if (result.exitCode === 0) {
			return result
		}

		if (attempt === retryCount || isTerminalTmuxError(result.stderr)) {
			return result
		}
	}

	return lastResult
}
