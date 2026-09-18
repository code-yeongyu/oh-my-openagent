import type { ReplaceTmuxPaneDeps, TmuxConfig } from "@oh-my-opencode/tmux-core";
import type { SpawnPaneResult } from "../types";
export declare function replaceTmuxPane(paneId: string, sessionId: string, description: string, config: TmuxConfig, _serverUrl: string, _directory: string, depsInput?: Partial<ReplaceTmuxPaneDeps>): Promise<SpawnPaneResult>;
