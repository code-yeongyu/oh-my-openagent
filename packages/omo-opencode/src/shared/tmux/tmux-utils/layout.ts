import {
  applyLayout,
  enforceMainPaneWidth as enforceMainPaneWidthCore,
} from "@oh-my-opencode/tmux-core"
import type { MainPaneWidthOptions } from "@oh-my-opencode/tmux-core"

export async function enforceMainPaneWidth(
	mainPaneId: string,
	windowWidth: number,
	mainPaneSizeOrOptions?: number | MainPaneWidthOptions,
): Promise<void> {
  const [{ log }, { getTmuxPath }, { runTmuxCommand }] = await Promise.all([
    import("../../logger"),
    import("../../../tools/interactive-bash/tmux-path-resolver"),
    import("../runner"),
  ])
	return enforceMainPaneWidthCore(mainPaneId, windowWidth, mainPaneSizeOrOptions, {
    log,
    getTmuxPath,
    runTmuxCommand,
  })
}

export { applyLayout }
export type { MainPaneWidthOptions }
