import { getIsolatedSessionName } from "@oh-my-opencode/tmux-core";
import type { SpawnTmuxSessionDeps, TmuxConfig } from "@oh-my-opencode/tmux-core";
import type { SpawnPaneResult } from "../types";
export declare function spawnTmuxSession(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, _directory: string, sourcePaneId?: string, depsInput?: Partial<SpawnTmuxSessionDeps>, managerId?: string): Promise<SpawnPaneResult>;
export { getIsolatedSessionName };
