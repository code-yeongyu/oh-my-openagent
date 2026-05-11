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
	const { runTmuxCommand } = await import("../runner")

	const result = await runTmuxCommand(tmux, ["display", "-p", "-t", paneId, "#{pane_width},#{window_width}"])

	if (result.exitCode !== 0) return null

	const [paneWidth, windowWidth] = result.output.trim().split(",").map(Number)
	if (Number.isNaN(paneWidth) || Number.isNaN(windowWidth)) return null

	return { paneWidth, windowWidth }
}
