import type { SpawnTmuxWindowDeps, TmuxConfig } from "@oh-my-opencode/tmux-core";
import type { SpawnPaneResult } from "../types";
export declare function spawnTmuxWindow(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, _directory: string, depsInput?: Partial<SpawnTmuxWindowDeps>): Promise<SpawnPaneResult>;
