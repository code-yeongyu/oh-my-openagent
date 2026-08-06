import type { TmuxCommandResult } from "../runner"

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export type CloseTmuxPaneDependencies = {
	readonly isInsideTmux: () => boolean
	readonly getTmuxPath: () => Promise<string | null | undefined>
	readonly runTmuxCommand: (tmuxPath: string, args: string[]) => Promise<TmuxCommandResult>
	readonly log: (message: string, data?: unknown) => void
	readonly delay: (milliseconds: number) => Promise<void>
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
	const [{ isInsideTmux }, { runTmuxCommand }] = await Promise.all([
		import("./environment"),
		import("../runner"),
	])

	return closeTmuxPaneWithDependencies(paneId, {
		isInsideTmux,
		getTmuxPath: async () => null,
		runTmuxCommand,
		log: () => undefined,
		delay,
	})
}

export async function closeTmuxPaneWithDependencies(
	paneId: string,
	dependencies: CloseTmuxPaneDependencies,
): Promise<boolean> {
	if (!dependencies.isInsideTmux()) {
		dependencies.log("[closeTmuxPane] SKIP: not inside tmux")
		return false
	}

	const tmux = await dependencies.getTmuxPath()
	if (!tmux) {
		dependencies.log("[closeTmuxPane] SKIP: tmux not found")
		return false
	}

	dependencies.log("[closeTmuxPane] sending Ctrl+C for graceful shutdown", { paneId })
	await dependencies.runTmuxCommand(tmux, ["send-keys", "-t", paneId, "C-c"])

	await dependencies.delay(250)

	dependencies.log("[closeTmuxPane] killing pane", { paneId })

	const result = await dependencies.runTmuxCommand(tmux, ["kill-pane", "-t", paneId])
	const trimmedStderr = result.stderr.trim()
	const paneAlreadyGone = result.exitCode !== 0 && /can't find pane/i.test(trimmedStderr)

	if (paneAlreadyGone) {
		dependencies.log("[closeTmuxPane] SUCCESS (pane already closed by Ctrl+C)", { paneId })
		return true
	}

	if (result.exitCode !== 0) {
		dependencies.log("[closeTmuxPane] FAILED", { paneId, exitCode: result.exitCode, stderr: trimmedStderr })
		return false
	}

	dependencies.log("[closeTmuxPane] SUCCESS", { paneId })
	return true
}
