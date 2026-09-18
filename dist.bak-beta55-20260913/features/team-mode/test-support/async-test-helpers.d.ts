import type { BackgroundTask, LaunchInput } from "../../background-agent/types";
export type LaunchConcurrencySnapshot = {
    readonly launchCount: number;
    readonly inFlight: number;
    readonly maxInFlight: number;
};
export type LaunchConcurrencyProbe = {
    readonly launch: (input: LaunchInput) => Promise<BackgroundTask>;
    readonly release: () => void;
    readonly releaseAndWaitForCompletion: <T>(promise: Promise<T>) => Promise<T>;
    readonly snapshot: () => LaunchConcurrencySnapshot;
    readonly waitForFirstBatch: () => Promise<LaunchConcurrencySnapshot>;
};
export type LaunchConcurrencyProbeOptions = {
    readonly launchLimit: number;
    readonly sessionIdPrefix: string;
    readonly taskIdPrefix: string;
};
export declare function createLaunchConcurrencyProbe(options: LaunchConcurrencyProbeOptions): LaunchConcurrencyProbe;
