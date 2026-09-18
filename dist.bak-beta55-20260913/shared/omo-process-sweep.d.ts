import { sweepOrphanedLspDaemonProxies, sweepStaleLspDaemonVersions } from "@oh-my-opencode/utils/process-sweep";
export interface OmoFamilySweepOptions {
    readonly log?: (message: string) => void;
}
export interface OmoFamilySweeps {
    readonly sweepLspProxies: typeof sweepOrphanedLspDaemonProxies;
    readonly sweepStaleLspDaemons: typeof sweepStaleLspDaemonVersions;
}
export declare function sweepOrphanedLspDaemonProxiesBestEffort(options: OmoFamilySweepOptions, sweep?: typeof sweepOrphanedLspDaemonProxies): Promise<void>;
export declare function sweepStaleLspDaemonVersionsBestEffort(options: OmoFamilySweepOptions, sweep?: typeof sweepStaleLspDaemonVersions): Promise<void>;
/**
 * Runs every omo sweep family concurrently. NEVER rejects: each family
 * is wrapped best-effort so a sweep failure can only produce a log line, not
 * a startup failure. Callers fire-and-forget the returned promise.
 */
export declare function sweepOmoFamiliesBestEffort(options?: OmoFamilySweepOptions, sweeps?: OmoFamilySweeps): Promise<void>;
