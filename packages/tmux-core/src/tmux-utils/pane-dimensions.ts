import { runTmuxCommand } from "../runner"

export interface PaneDimensions {
	paneWidth: number
	windowWidth: number
}

export type GetPaneDimensionsDeps = {
	readonly getTmuxPath: () => Promise<string | null | undefined>
	readonly runTmuxCommand: typeof runTmuxCommand
}

export async function getPaneDimensions(
	paneId: string,
	deps: GetPaneDimensionsDeps = {
		getTmuxPath: async () => null,
		runTmuxCommand,
	},
): Promise<PaneDimensions | null> {
	const tmux = await deps.getTmuxPath()
	if (!tmux) return null

	const result = await deps.runTmuxCommand(tmux, ["display", "-p", "-t", paneId, "#{pane_width},#{window_width}"])

	if (result.exitCode !== 0) return null

	const [paneWidth, windowWidth] = result.output.trim().split(",").map(Number)
	if (Number.isNaN(paneWidth) || Number.isNaN(windowWidth)) return null

	return { paneWidth, windowWidth }
}
