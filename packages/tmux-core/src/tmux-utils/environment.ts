import { isCmuxCompatEnvironment } from "../cmux-detect"

export type SplitDirection = "-h" | "-v"

export function isInsideTmuxEnvironment(environment: Record<string, string | undefined>): boolean {
  return Boolean(environment.TMUX)
}

export function isTmuxPaneCompatibleEnvironment(environment: Record<string, string | undefined>): boolean {
	return isInsideTmuxEnvironment(environment) || isCmuxCompatEnvironment(environment)
}

export function isInsideTmux(): boolean {
	return isInsideTmuxEnvironment(process.env)
}

export function isTmuxPaneCompatible(): boolean {
	return isTmuxPaneCompatibleEnvironment(process.env)
}

export function getCurrentPaneId(): string | undefined {
	return process.env.TMUX_PANE
}
