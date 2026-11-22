export type OperationEffect = "read" | "mutate";
export type OperationMetadata = Readonly<{
    taskId: string;
    opSeq: number;
    effect: OperationEffect;
    opId?: string;
    capabilityToken?: string;
}>;
/** Convert runtime values to the exact plain JSON value used by the wire serializer. */
export declare const normalizeOperationArgs: (args: unknown) => unknown;
/** Read caller-owned metadata coordinates once so getters cannot desynchronize hash and wire fields. */
export declare const snapshotOperationMetadata: (metadata: OperationMetadata) => OperationMetadata;
/**
 * Wire-invoke identity: `computeOpId` over an envelope that includes the target machine. Task-scoped wire
 * counters restart at 0 per task, so without the machine in the hash, the same task issuing identical
 * (opSeq, op, args) against two machines would collide and the hub ledger would dedup the second machine's
 * op into the first machine's cached result.
 */
export declare const computeWireOpId: (machineId: string, taskId: string, opSeq: number, op: string, args: unknown) => string;
/**
 * Derive a replay-stable operation identity from the caller-owned task ordinal.
 * The tuple encoding keeps field boundaries unambiguous; absent args hash as an explicit `absent` marker.
 */
export declare const computeOpId: (taskId: string, opSeq: number, op: string, args: unknown) => string;
