import type { SpawnTmuxPaneDeps, TmuxConfig } from "@oh-my-opencode/tmux-core";
import type { SpawnPaneResult } from "../types";
import type { SplitDirection } from "./environment";
export declare function spawnTmuxPane(sessionId: string, description: string, config: TmuxConfig, serverUrl: string, _directory: string, targetPaneId?: string, splitDirection?: SplitDirection, depsInput?: Partial<SpawnTmuxPaneDeps>): Promise<SpawnPaneResult>;
