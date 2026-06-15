import {
  closeTmuxPaneWithDependencies,
  type CloseTmuxPaneDependencies,
} from "@oh-my-opencode/tmux-core"

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
	const [{ log }, { isInsideTmux }, { getTmuxPath }, { runTmuxCommand }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("../runner"),
	])

	return closeTmuxPaneWithDependencies(paneId, {
		isInsideTmux,
		getTmuxPath,
		runTmuxCommand,
		log,
		delay,
	})
}

export { closeTmuxPaneWithDependencies }
export type { CloseTmuxPaneDependencies }
