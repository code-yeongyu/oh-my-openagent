import { spawn } from "bun"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"

export interface PaneDimensions {
	paneWidth: number
	windowWidth: number
}

export async function getPaneDimensions(
	paneId: string,
): Promise<PaneDimensions | null> {
	const tmux = await getTmuxPath()
	if (!tmux) return null

	const proc = spawn(
		[tmux, "display", "-p", "-t", paneId, "#{pane_width},#{window_width}"],
		{ stdout: "pipe", stderr: "pipe" },
	)
	const exitCode = await proc.exited
	const stdout = await new Response(proc.stdout).text()

	if (exitCode !== 0) return null

	const [paneWidth, windowWidth] = stdout.trim().split(",").map(Number)
	if (Number.isNaN(paneWidth) || Number.isNaN(windowWidth)) return null

	return { paneWidth, windowWidth }
}
