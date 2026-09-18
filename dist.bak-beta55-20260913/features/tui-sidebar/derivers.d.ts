import type { TuiRuntimeSnapshot } from "./snapshot-schema";
import type { AgentsState, ConfigState, JobBoardState, LoopState, RosterRow, RosterState } from "./state-types";
export declare function deriveConfig(v: {
    readonly valid: boolean;
    readonly messages: readonly string[];
}): ConfigState;
export declare function deriveRoster(rows: readonly RosterRow[]): RosterState;
export declare function deriveAgents(snap: TuiRuntimeSnapshot | null): AgentsState;
export declare function deriveJobBoard(snap: TuiRuntimeSnapshot | null): JobBoardState;
export declare function deriveLoop(snap: TuiRuntimeSnapshot | null): LoopState;
