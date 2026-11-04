import type { FanoutOutcome, FanoutResult } from "./fanout-types.ts";
/** What a fanout driver reports while it runs: the resolved target count, then each outcome as it settles. */
export type FanoutSink<T> = {
    planned(total: number): void;
    emit(outcome: FanoutOutcome<T>): void;
};
/**
 * One fanout wave. Awaiting it gives the {@link FanoutResult} in input order, exactly as before; iterating it yields
 * every target's {@link FanoutOutcome} as soon as that target settles (skipped targets first, since they are known
 * before dispatch). Each iterator replays the outcomes already seen, so iterating late loses nothing. If the wave
 * fails before it settles (invalid options, `dedup: "reject"`, a directory read), awaiting rejects and iteration
 * throws the same error.
 */
export declare class FanoutRun<T> implements Promise<FanoutResult<T>>, AsyncIterable<FanoutOutcome<T>> {
    #private;
    readonly [Symbol.toStringTag] = "FanoutRun";
    constructor(drive: (sink: FanoutSink<T>) => Promise<FanoutResult<T>>);
    /** A run whose wave starts once `pending` resolves; used by lazy clients that connect on first use. `start`
     *  returns the inner run synchronously: a run is awaitable, so resolving a promise with one would unwrap it. */
    static defer<Source, T>(pending: Promise<Source>, start: (source: Source) => FanoutRun<T>): FanoutRun<T>;
    /** Outcomes settled so far, skipped targets included. */
    get settled(): number;
    /** Resolved targets not settled yet. 0 until target resolution finishes (see {@link FanoutRun.total}). */
    get remaining(): number;
    /** Number of resolved targets, or `undefined` while targets are still being resolved. */
    get total(): number | undefined;
    then<Fulfilled = FanoutResult<T>, Rejected = never>(onfulfilled?: ((value: FanoutResult<T>) => Fulfilled | PromiseLike<Fulfilled>) | null, onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null): Promise<Fulfilled | Rejected>;
    catch<Rejected = never>(onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null): Promise<FanoutResult<T> | Rejected>;
    finally(onfinally?: (() => void) | null): Promise<FanoutResult<T>>;
    [Symbol.asyncIterator](): AsyncGenerator<FanoutOutcome<T>, void, undefined>;
}
