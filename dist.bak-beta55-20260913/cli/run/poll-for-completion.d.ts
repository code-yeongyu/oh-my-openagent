import type { RunContext } from "./types";
import type { EventState } from "./events";
export interface PollOptions {
    pollIntervalMs?: number;
    requiredConsecutive?: number;
    minStabilizationMs?: number;
    eventWatchdogMs?: number;
    secondaryMeaningfulWorkTimeoutMs?: number;
    requireMeaningfulWork?: boolean;
    /** Injectable clock (default Date.now). Tests drive a virtual clock to assert timing causality deterministically. */
    now?: () => number;
    /** Injectable poll delay (default real setTimeout). Tests advance the virtual clock here instead of sleeping. */
    sleep?: (ms: number) => Promise<void>;
}
export declare function pollForCompletion(ctx: RunContext, eventState: EventState, abortController: AbortController, options?: PollOptions): Promise<number>;
