import type { StandaloneMachine } from "./types.ts";
export type { FanoutRun } from "./fanout-run.ts";
export type FanoutTarget = StandaloneMachine | string;
export type FanoutResult<T> = {
    readonly fulfilled: ReadonlyArray<{
        readonly machine: StandaloneMachine;
        readonly value: T;
    }>;
    readonly rejected: ReadonlyArray<{
        readonly machine: StandaloneMachine;
        readonly error: Error;
    }>;
    /** Targets not dispatched, in input order: offline machines (reason `machine_offline`), machines the transport
     *  cannot run operations on (reason `machine_unsupported`), bridged rows while bridges are disabled (reason
     *  `bridge_disabled`) and, under `dedup: "first"`, duplicate occurrences. Present ONLY when at least one target
     *  was skipped, or always under `dedup: "first"`. */
    readonly skipped?: ReadonlyArray<{
        readonly machine: StandaloneMachine;
        readonly reason?: string;
    }>;
};
/** Why a target was skipped before dispatch. A duplicate under `dedup: "first"` carries no reason. */
export type FanoutSkipReason = "machine_offline" | "machine_unsupported" | "bridge_disabled";
/** One target's outcome, yielded by iterating a {@link FanoutRun} as soon as it settles. `index` is the target's
 *  position in the resolved target list, so a consumer can rebuild input order from the stream. */
export type FanoutOutcome<T> = {
    readonly kind: "fulfilled";
    readonly machine: StandaloneMachine;
    readonly value: T;
    readonly index: number;
} | {
    readonly kind: "rejected";
    readonly machine: StandaloneMachine;
    readonly error: Error;
    readonly index: number;
} | {
    readonly kind: "skipped";
    readonly machine: StandaloneMachine;
    readonly reason?: string;
    readonly index: number;
};
/** Duplicate-target policy for `fanout`, keyed by `machine.id`. `"none"` dispatches duplicates like any other
 *  target; `"first"` runs only the first occurrence and records the rest as `skipped`; `"reject"` fails the
 *  whole wave with a `FanoutDuplicateTargetError` before any callback is dispatched. */
export type FanoutDedupMode = "none" | "first" | "reject";
export type FanoutOptions = {
    /** Include bridged rows in broad selections; overrides operator.bridges.fanout. Explicit lists are never filtered. */
    readonly includeBridged?: boolean;
    /** Explicitly permit registry operations that disrupt the agent or host. Does not grant a capability token. */
    readonly allowDisruptive?: boolean;
    /** Optional tag selector. Explicit values override operator.json fanoutDefaults.tag. */
    readonly tag?: string;
    /** Maximum callbacks in flight at once. Positive integer, or `Infinity`. The client's default applies when
     *  omitted: `Infinity` for `@sisyphuslabs/bunshin-ts` (every runnable target starts in the same tick), 16 for the
     *  `@bunshin/machine-sdk` compatibility facade. */
    readonly concurrency?: number;
    /** Duplicate-`machine.id` policy across the resolved target list. Default `"none"`. */
    readonly dedup?: FanoutDedupMode;
    /** Per-target timeout: the `FanoutContext.signal` handed to each callback aborts after this many milliseconds and
     *  the target settles as a `FanoutTimeoutError`. */
    readonly timeoutMs?: number;
    /** What a `timeoutMs` expiry does to the callback. `true`: the signal is also bound to every operation the
     *  callback issues through its machine, the target settles at once and frees its concurrency slot, and the
     *  callback's eventual value is discarded. `false`: cooperative only; the target is classified at the deadline
     *  but its slot stays held until the callback settles on its own. The client's default applies when omitted:
     *  `true` for `@sisyphuslabs/bunshin-ts`, `false` for the `@bunshin/machine-sdk` compatibility facade. */
    readonly cancelOnTimeout?: boolean;
};
/** Second argument handed to a `fanout` callback. */
export type FanoutContext = {
    /** Aborts when `timeoutMs` elapses for this target. */
    readonly signal: AbortSignal;
};
