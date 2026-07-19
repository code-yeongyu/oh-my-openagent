import { spawnTmuxPane as spawnTmuxPaneCore } from "@oh-my-opencode/tmux-core"
import type { SpawnTmuxPaneDeps, TmuxConfig, TmuxServerTarget } from "@oh-my-opencode/tmux-core"
import type { SpawnPaneResult } from "../types"
import { normalizeOpenCodeTmuxServerTarget } from "../opencode-server-access"
import type { SplitDirection } from "./environment"
import { withPaneSpawnDeps } from "./adapter-deps"

export async function spawnTmuxPane(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverTarget: TmuxServerTarget,
	_directory: string,
	targetPaneId?: string,
	splitDirection: SplitDirection = "-h",
	depsInput?: Partial<SpawnTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	return spawnTmuxPaneCore(
		sessionId,
		description,
		config,
		normalizeOpenCodeTmuxServerTarget(serverTarget),
		_directory,
		targetPaneId,
		splitDirection,
		withPaneSpawnDeps(depsInput),
	)
}
