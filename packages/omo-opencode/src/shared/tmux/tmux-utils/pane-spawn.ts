import { spawnTmuxPane as spawnTmuxPaneCore } from "@oh-my-opencode/tmux-core"
import type { SpawnTmuxPaneDeps, TmuxConfig } from "@oh-my-opencode/tmux-core"
import type { SpawnPaneResult } from "../types"
import type { SplitDirection } from "./environment"
import { withPaneSpawnDeps } from "./adapter-deps"

export async function spawnTmuxPane(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	_directory: string,
	targetPaneId?: string,
	splitDirection: SplitDirection = "-h",
	depsInput?: Partial<SpawnTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	return spawnTmuxPaneCore(
		sessionId,
		description,
		config,
		serverUrl,
		_directory,
		targetPaneId,
		splitDirection,
		withPaneSpawnDeps(depsInput),
	)
}
