import { FanoutRun, type FanoutSink } from "./fanout-run.ts";
import type { FanoutContext, FanoutDedupMode, FanoutOptions, FanoutOutcome, FanoutResult } from "./fanout-types.ts";
import type { StandaloneMachine } from "./types.ts";
/** Invalid `FanoutOptions` supplied to `fanout()`. Rejected before any target resolution or dispatch. */
export declare class FanoutOptionsError extends Error {
    constructor(message: string);
}
/** A fanout target exceeded its `timeoutMs`. Its callback's eventual value or rejection is discarded. Under
 *  `cancelOnTimeout: false` the callback keeps its concurrency slot until it settles; under `cancelOnTimeout: true`
 *  the slot is released at the deadline and the target's operations see the aborted signal. */
export declare class FanoutTimeoutError extends Error {
    constructor(message: string);
}
/** `fanout(..., { dedup: "reject" })` saw the same `machine.id` twice in the resolved target list. No callback
 *  was dispatched. */
export declare class FanoutDuplicateTargetError extends Error {
    readonly machineId: string;
    constructor(machineId: string, message: string);
}
/** The defaults a client applies when a wave leaves `concurrency` or `cancelOnTimeout` unset. */
export type FanoutDefaults = {
    readonly concurrency: number;
    readonly cancelOnTimeout: boolean;
};
/** No concurrency cap: every runnable target starts in the same tick, and a timeout cancels its target. */
export declare const UNLIMITED_FANOUT_DEFAULTS: FanoutDefaults;
type ParsedFanoutOptions = {
    readonly concurrency: number | undefined;
    readonly dedup: FanoutDedupMode;
    readonly timeoutMs: number | undefined;
    readonly cancelOnTimeout: boolean | undefined;
};
/** A wave's settings once the client's defaults are applied. */
export type ResolvedFanoutOptions = {
    readonly concurrency: number;
    readonly dedup: FanoutDedupMode;
    readonly timeoutMs: number | undefined;
    readonly cancelOnTimeout: boolean;
};
export declare const parseFanoutOptions: (options: FanoutOptions | undefined) => ParsedFanoutOptions;
export declare const resolveFanoutOptions: (parsed: ParsedFanoutOptions, defaults: FanoutDefaults) => ResolvedFanoutOptions;
export declare const guardFanoutMachine: <T extends StandaloneMachine>(machine: T) => T;
type TargetRun<T> = {
    readonly index: number;
    readonly timeoutMs: number | undefined;
    readonly cancelOnTimeout: boolean;
    /** Called once, the moment the target's outcome is decided. */
    readonly onSettled: (outcome: FanoutOutcome<T>) => void;
};
/** Run one target's callback. Resolves when the target's concurrency slot is free: at classification under
 *  `cancelOnTimeout`, or once the callback itself settles otherwise. */
export declare const runFanoutTarget: <T>(machine: StandaloneMachine, fn: (machine: StandaloneMachine, context: FanoutContext) => Promise<T>, run: TargetRun<T>) => Promise<void>;
type RunnableTarget = {
    readonly machine: StandaloneMachine;
    readonly index: number;
};
/** One wave, in input order: the outcome slot of every target, and the targets that still need a callback. */
type FanoutPlan<T> = {
    readonly outcomes: Array<FanoutOutcome<T> | undefined>;
    readonly runnable: readonly RunnableTarget[];
};
/** Classify every resolved target before anything is dispatched: skipped (bridges off, offline, unsupported,
 *  duplicate under `dedup: "first"`), runnable, or, under `dedup: "reject"`, a duplicate that fails the whole
 *  wave. */
export declare const planFanout: <T>(machines: readonly StandaloneMachine[], policy: {
    readonly bridgesEnabled: boolean | undefined;
    readonly dedup: FanoutDedupMode;
}) => FanoutPlan<T>;
/** Run the plan's runnable targets. `Infinity` starts every callback in this tick; a finite `concurrency` runs them
 *  through a pool of at most that many workers. */
export declare const runFanoutPool: <T>(plan: FanoutPlan<T>, concurrency: number, run: (target: RunnableTarget) => Promise<void>) => Promise<void>;
/** Fold the outcome slots, in input order, into the public result shape. */
export declare const foldFanoutOutcomes: <T>(outcomes: ReadonlyArray<FanoutOutcome<T> | undefined>, dedup: FanoutDedupMode) => FanoutResult<T>;
/** Plan, dispatch and fold one wave over already-resolved machines, reporting progress to `sink`. Skipped targets
 *  are reported before the first callback starts. */
export declare const executeFanout: <T>(sink: FanoutSink<T>, machines: readonly StandaloneMachine[], fn: (machine: StandaloneMachine, context: FanoutContext) => Promise<T>, options: ResolvedFanoutOptions & {
    readonly bridgesEnabled: boolean | undefined;
}) => Promise<FanoutResult<T>>;
/**
 * Fan `fn` out over an explicit list of machines, from any mix of transports. Unlimited by default: every runnable
 * target's callback starts in the same tick, and `timeoutMs` cancels its target (`cancelOnTimeout: true`). Offline
 * and unsupported machines are skipped before dispatch (C-FANOUT-1). A `tag` option is refused: there is no
 * directory here to select from, and an explicit list plus a tag is ambiguous (C-FANOUT-2).
 */
export declare const fanout: <T>(machines: readonly StandaloneMachine[], fn: (machine: StandaloneMachine, context: FanoutContext) => Promise<T>, options?: FanoutOptions) => FanoutRun<T>;
export {};
