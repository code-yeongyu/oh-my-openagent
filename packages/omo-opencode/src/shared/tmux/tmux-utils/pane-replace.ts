import { replaceTmuxPane as replaceTmuxPaneCore } from "@oh-my-opencode/tmux-core"
import type { ReplaceTmuxPaneDeps, TmuxConfig, TmuxServerTarget } from "@oh-my-opencode/tmux-core"
import type { SpawnPaneResult } from "../types"
import { normalizeOpenCodeTmuxServerTarget } from "../opencode-server-access"
import { withPaneReplaceDeps } from "./adapter-deps"

export async function replaceTmuxPane(
	paneId: string,
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverTarget: TmuxServerTarget,
	_directory: string,
	depsInput?: Partial<ReplaceTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	return replaceTmuxPaneCore(
		paneId,
		sessionId,
		description,
		config,
		normalizeOpenCodeTmuxServerTarget(serverTarget),
		_directory,
		withPaneReplaceDeps(depsInput),
	)
}
