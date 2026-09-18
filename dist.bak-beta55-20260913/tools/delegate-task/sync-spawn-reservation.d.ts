import type { ExecutorContext, ParentContext } from "./executor-types";
export interface SyncSpawnReservation {
    readonly spawnContext: {
        readonly rootSessionID: string;
        readonly parentDepth: number;
        readonly childDepth: number;
    };
    readonly reservation: Awaited<ReturnType<ExecutorContext["manager"]["reserveSubagentSpawn"]>> | undefined;
}
export declare function reserveSyncSubagentSpawn(executorCtx: Pick<ExecutorContext, "manager">, parentContext: Pick<ParentContext, "sessionID">): Promise<SyncSpawnReservation>;
