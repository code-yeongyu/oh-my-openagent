export type SplitDirection = "-h" | "-v"

export function isInsideTmuxEnvironment(environment: Record<string, string | undefined>): boolean {
  return Boolean(environment.TMUX)
}

export function isInsideTmux(): boolean {
	return isInsideTmuxEnvironment(process.env)
}

export function getCurrentPaneId(): string | undefined {
	return process.env.TMUX_PANE
}
