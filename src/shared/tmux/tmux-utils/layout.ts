import { spawn } from "bun"
import type { TmuxLayout } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"

export async function applyLayout(
	tmux: string,
	layout: TmuxLayout,
	mainPaneSize: number,
): Promise<void> {
	const layoutProc = spawn([tmux, "select-layout", layout], {
		stdout: "ignore",
		stderr: "ignore",
	})
	await layoutProc.exited

	if (layout.startsWith("main-")) {
		const dimension =
			layout === "main-horizontal" ? "main-pane-height" : "main-pane-width"
		const sizeProc = spawn(
			[tmux, "set-window-option", dimension, `${mainPaneSize}%`],
			{ stdout: "ignore", stderr: "ignore" },
		)
		await sizeProc.exited
	}
}

export async function enforceMainPaneWidth(
	mainPaneId: string,
	windowWidth: number,
): Promise<void> {
	const { log } = await import("../../logger")
	const tmux = await getTmuxPath()
	if (!tmux) return

	const dividerWidth = 1
	const mainWidth = Math.floor((windowWidth - dividerWidth) / 2)

	const proc = spawn([tmux, "resize-pane", "-t", mainPaneId, "-x", String(mainWidth)], {
		stdout: "ignore",
		stderr: "ignore",
	})
	await proc.exited

	log("[enforceMainPaneWidth] main pane resized", {
		mainPaneId,
		mainWidth,
		windowWidth,
	})
}
