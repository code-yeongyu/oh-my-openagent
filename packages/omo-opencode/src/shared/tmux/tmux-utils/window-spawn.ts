import { spawnTmuxWindow as spawnTmuxWindowCore } from "@oh-my-opencode/tmux-core"
import type { SpawnTmuxWindowDeps, TmuxConfig, TmuxServerTarget } from "@oh-my-opencode/tmux-core"
import type { SpawnPaneResult } from "../types"
import { normalizeOpenCodeTmuxServerTarget } from "../opencode-server-access"
import { withWindowSpawnDeps } from "./adapter-deps"

export async function spawnTmuxWindow(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverTarget: TmuxServerTarget,
	_directory: string,
	depsInput?: Partial<SpawnTmuxWindowDeps>,
): Promise<SpawnPaneResult> {
	return spawnTmuxWindowCore(
		sessionId,
		description,
		config,
		normalizeOpenCodeTmuxServerTarget(serverTarget),
		_directory,
		withWindowSpawnDeps(depsInput),
	)
}
