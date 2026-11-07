import type { MachineTaskOptions, ReplayJournalEntry, StepFn } from "./types.ts";
/**
 * Per-task memoization context for the step() idiom. Assigns each distinct step name a monotonic `opSeq` (never from
 * a store — D1), pins the clock/RNG from the taskId so re-executed steps recompute identical args, derives a
 * replay-stable `opId`, and aborts a re-drive whose opId no longer matches the prior journal's seq.
 */
export declare class TaskContext {
    readonly taskId: string;
    private readonly clock;
    private readonly priorBySeq;
    private readonly seqByName;
    private nextSeq;
    private nextWireSeq;
    private readonly journal;
    constructor(taskId: string, options?: MachineTaskOptions);
    runStep<Result>(name: string, fn: StepFn<Result>): Promise<Result>;
    snapshot(): readonly ReplayJournalEntry[];
    /** Wire ordinal for task-scoped invokes; a separate stream from step names so wrapping an existing invoke
     *  in step() never renumbers later wire ops. Every attempted invoke draws exactly one ordinal. */
    nextWireOpSeq(): number;
    private opSeqFor;
    private assertJournalConsistent;
}
