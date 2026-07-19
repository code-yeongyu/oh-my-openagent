import {
	getIsolatedSessionName,
	spawnTmuxSession as spawnTmuxSessionCore,
} from "@oh-my-opencode/tmux-core"
import type { SpawnTmuxSessionDeps, TmuxConfig, TmuxServerTarget } from "@oh-my-opencode/tmux-core"
import type { SpawnPaneResult } from "../types"
import { normalizeOpenCodeTmuxServerTarget } from "../opencode-server-access"
import { withSessionSpawnDeps } from "./adapter-deps"

export async function spawnTmuxSession(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverTarget: TmuxServerTarget,
	_directory: string,
	sourcePaneId?: string,
	depsInput?: Partial<SpawnTmuxSessionDeps>,
	managerId?: string,
): Promise<SpawnPaneResult> {
	return spawnTmuxSessionCore(
		sessionId,
		description,
		config,
		normalizeOpenCodeTmuxServerTarget(serverTarget),
		_directory,
		sourcePaneId,
		withSessionSpawnDeps(depsInput),
		managerId,
	)
}

export { getIsolatedSessionName }
