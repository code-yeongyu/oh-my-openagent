import type { ActivateTmuxPaneDeps, EnforceMainPaneWidthDeps, GetPaneDimensionsDeps, KillTmuxSessionDeps, ReplaceTmuxPaneDeps, SpawnTmuxPaneDeps, SpawnTmuxSessionDeps, SpawnTmuxWindowDeps } from "@oh-my-opencode/tmux-core";
export declare function withPaneSpawnDeps(deps?: Partial<SpawnTmuxPaneDeps>): Partial<SpawnTmuxPaneDeps>;
export declare function withPaneReplaceDeps(deps?: Partial<ReplaceTmuxPaneDeps>): Partial<ReplaceTmuxPaneDeps>;
export declare function withWindowSpawnDeps(deps?: Partial<SpawnTmuxWindowDeps>): Partial<SpawnTmuxWindowDeps>;
export declare function withSessionSpawnDeps(deps?: Partial<SpawnTmuxSessionDeps>): Partial<SpawnTmuxSessionDeps>;
export declare function paneActivateDeps(): ActivateTmuxPaneDeps;
export declare function paneDimensionsDeps(): GetPaneDimensionsDeps;
export declare function mainPaneWidthDeps(): EnforceMainPaneWidthDeps;
export declare function sessionKillDeps(): KillTmuxSessionDeps;
