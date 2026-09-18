import type { TmuxConfig } from "../../config/schema";
export type StaleTmuxResourceSweepReport = {
    readonly killed: number;
    readonly killedAttachPanes: number;
    readonly killedIsolatedSessions: number;
};
export type StaleTmuxResourceSweepDeps = {
    readonly isolation: TmuxConfig["isolation"];
    readonly sweepStaleOmoAgentSessions: () => Promise<number>;
    readonly sweepStaleOmoAttachPanes: () => Promise<number>;
};
export declare function sweepStaleTmuxResources(deps: StaleTmuxResourceSweepDeps): Promise<StaleTmuxResourceSweepReport>;
