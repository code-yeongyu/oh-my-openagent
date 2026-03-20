import { spawn } from "bun"
import type { TmuxLayout } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"

type TmuxSpawnCommand = (
	args: string[],
	options: { stdout: "ignore"; stderr: "ignore" },
) => { exited: Promise<number> }

interface LayoutDeps {
	spawnCommand?: TmuxSpawnCommand
}

interface MainPaneWidthOptions {
	mainPaneSize?: number
	mainPaneMinWidth?: number
	agentPaneMinWidth?: number
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function calculateMainPaneWidth(
	windowWidth: number,
	options?: MainPaneWidthOptions,
): number {
	const dividerWidth = 1
	const sizePercent = clamp(options?.mainPaneSize ?? 50, 20, 80)
	const minMainPaneWidth = options?.mainPaneMinWidth ?? 0
	const minAgentPaneWidth = options?.agentPaneMinWidth ?? 0
	const desiredMainPaneWidth = Math.floor(
		(windowWidth - dividerWidth) * (sizePercent / 100),
	)
	const maxMainPaneWidth = Math.max(
		0,
		windowWidth - dividerWidth - minAgentPaneWidth,
	)

	return clamp(Math.max(desiredMainPaneWidth, minMainPaneWidth), 0, maxMainPaneWidth)
}

export async function applyLayout(
	tmux: string,
	layout: TmuxLayout,
	mainPaneSize: number,
	deps?: LayoutDeps,
): Promise<void> {
	const spawnCommand: TmuxSpawnCommand = deps?.spawnCommand ?? spawn
	const layoutProc = spawnCommand([tmux, "select-layout", layout], {
		stdout: "ignore",
		stderr: "ignore",
	})
	await layoutProc.exited

	if (layout.startsWith("main-")) {
		const dimension =
			layout === "main-horizontal" ? "main-pane-height" : "main-pane-width"
		const sizeProc = spawnCommand(
			[tmux, "set-window-option", dimension, `${mainPaneSize}%`],
			{ stdout: "ignore", stderr: "ignore" },
		)
		await sizeProc.exited
	}
}

export async function enforceMainPaneWidth(
	mainPaneId: string,
	windowWidth: number,
	mainPaneSizeOrOptions?: number | MainPaneWidthOptions,
): Promise<void> {
	const { log } = await import("../../logger")
	const tmux = await getTmuxPath()
	if (!tmux) return

	const options: MainPaneWidthOptions =
		typeof mainPaneSizeOrOptions === "number"
			? { mainPaneSize: mainPaneSizeOrOptions }
			: mainPaneSizeOrOptions ?? {}
	const mainWidth = calculateMainPaneWidth(windowWidth, options)

	const proc = spawn([tmux, "resize-pane", "-t", mainPaneId, "-x", String(mainWidth)], {
		stdout: "ignore",
		stderr: "ignore",
	})
	await proc.exited

	log("[enforceMainPaneWidth] main pane resized", {
		mainPaneId,
		mainWidth,
		windowWidth,
		mainPaneSize: options?.mainPaneSize,
		mainPaneMinWidth: options?.mainPaneMinWidth,
		agentPaneMinWidth: options?.agentPaneMinWidth,
	})
}
