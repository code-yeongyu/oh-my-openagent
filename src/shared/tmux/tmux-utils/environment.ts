export type SplitDirection = "-h" | "-v"

export function isInsideTmux(): boolean {
	return Boolean(process.env.TMUX)
}

export function getCurrentPaneId(): string | undefined {
	return process.env.TMUX_PANE
}
