import {
	getIsolatedSessionName,
	spawnTmuxSession as spawnTmuxSessionCore,
} from "@oh-my-opencode/tmux-core"
import type { SpawnTmuxSessionDeps, TmuxConfig } from "@oh-my-opencode/tmux-core"
import type { SpawnPaneResult } from "../types"
import { withSessionSpawnDeps } from "./adapter-deps"

export async function spawnTmuxSession(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	_directory: string,
	sourcePaneId?: string,
	depsInput?: Partial<SpawnTmuxSessionDeps>,
	managerId?: string,
): Promise<SpawnPaneResult> {
	return spawnTmuxSessionCore(
		sessionId,
		description,
		config,
		serverUrl,
		_directory,
		sourcePaneId,
		withSessionSpawnDeps(depsInput),
		managerId,
	)
}

export { getIsolatedSessionName }
